import { Telegraf, Markup } from 'telegraf';
import { BotContext } from '../helper_functions/botContext';
import { executeSwap, SwapResult, getQuote } from '../helper_functions/trade';
import getUser from '../helper_functions/getUserInfo';
import scanToken from '../helper_functions/tokenScanner';
import { addTradeToUser } from '../helper_functions/positionManager';
import { isValidSolanaPrivateKey } from '../helper_functions/privateKEy_validator';
import getTokenDecimals from '../helper_functions/tokenmetaData';
import { ITrade } from '../models/schema';

interface ITokenInfo {
    address: string;
    tokenName: string;
    tokenSymbol: string;
    tokenInfo: {
        mktCap: number;
        price: number;
    };
}

const swapAction = (bot: Telegraf<BotContext>) => {
    ['0.1', '0.5', '1', '2', '5', '10'].forEach(amount => {
        bot.action(`buy_${amount}`, async (ctx) => {
            try {
                if (!ctx.from?.id) return;
                if (!ctx.session.tokenCA) {
                    await ctx.reply('❌ No token selected. Please select a token first.');
                    return;
                }

                const telegram_id = ctx.from.id.toString();
                const userDetails = await getUser(telegram_id);

                if (!userDetails.privateKey || !isValidSolanaPrivateKey(userDetails.privateKey)) {
                    await ctx.reply('❌ Invalid Solana wallet configuration. Please check your wallet setup.');
                    return;
                }

                const amountInSol = parseFloat(amount);

                if (userDetails.userBalance < amountInSol) {
                    await ctx.reply('❌ Insufficient balance. Please add more SOL to your wallet.');
                    return;
                }

                await ctx.reply(`🔄 Processing buy order for ${amount} SOL...`);

                // Get token info, decimals, and quote
                const tokenData = await scanToken(ctx.session.tokenCA);
                if (!tokenData) {
                    await ctx.reply('❌ Error: Unable to fetch token information.');
                    return;
                }

                const tokenDecimals = await getTokenDecimals(ctx.session.tokenCA);
                const lamports = amountInSol * 1e9; // SOL decimals are always 9
                const quote = await getQuote(ctx.session.tokenCA, true, lamports);

                const result: SwapResult = await executeSwap(
                    ctx.session.tokenCA,
                    true,
                    lamports,
                    userDetails.privateKey
                );

                if (result.success && result.signature) {
                    const receivedAmount = Number(quote.outAmount) / Math.pow(10, tokenDecimals);
    
                    // Store the trade - no need to adjust quote.outAmount as addTradeToUser now handles it
                    await addTradeToUser(
                        telegram_id,
                        {
                            address: ctx.session.tokenCA,
                            tokenName: tokenData.tokenName,
                            tokenSymbol: tokenData.tokenSymbol,
                            tokenInfo: {
                                mktCap: tokenData.tokenInfo.mktCap,
                                price: tokenData.tokenInfo.price
                            }
                        },
                        quote, // Pass the original quote
                        amountInSol
                    );
                
                    const successMessage = `✅ Trade Successful!\n\n` +
                        `💰 Spent: ${amountInSol} SOL\n` +
                        `🪙 Received: ${receivedAmount.toFixed(tokenDecimals)} ${tokenData.tokenSymbol}\n` +
                        `📈 Price Impact: ${(Number(quote.priceImpactPct) || 0).toFixed(2)}%\n` +
                        `🔗 Transaction: [View on Solscan](${result.txUrl})`;

                    const keyboard = Markup.inlineKeyboard([
                        [Markup.button.callback('View Positions', 'positions')],
                        [Markup.button.callback('Main Menu', 'start')]
                    ]);

                    await ctx.reply(successMessage, {
                        parse_mode: 'Markdown',
                        reply_markup: keyboard.reply_markup
                    });
                } else {
                    await ctx.reply(`❌ Transaction failed: ${result.error}`);
                }

            } catch (error) {
                console.error(`Error processing ${amount} SOL buy:`, error);
                await ctx.reply('❌ Error processing buy order. Please try again.');
            }
        });
    });

    ['25', '50', '75', '100'].forEach(percentage => {
        bot.action(`sell_${percentage}`, async (ctx) => {
            try {
                if (!ctx.from?.id || !ctx.session.tokenCA) {
                    await ctx.reply('❌ No token selected. Please select a token first.');
                    return;
                }

                const telegram_id = ctx.from.id.toString();
                const userDetails = await getUser(telegram_id);
                const positions = await userDetails.getPositions();
                
                const tokenPosition = positions.find(p => p.tokenAddress === ctx.session.tokenCA);
                if (!tokenPosition) {
                    await ctx.reply('❌ No position found for this token.');
                    return;
                }

                const sellPercentage = parseInt(percentage) / 100;
                const tokenAmount = tokenPosition.totalTokens * sellPercentage;

                const tokenData = await scanToken(ctx.session.tokenCA);
                if (!tokenData) {
                    await ctx.reply('❌ Error: Unable to fetch token information.');
                    return;
                }

                const tokenDecimals = await getTokenDecimals(ctx.session.tokenCA);
                const tokenBaseUnits = Math.floor(tokenAmount * Math.pow(10, tokenDecimals));
                const quote = await getQuote(ctx.session.tokenCA, false, tokenBaseUnits);

                const result = await executeSwap(
                    ctx.session.tokenCA,
                    false,
                    tokenBaseUnits,
                    userDetails.privateKey
                );

                if (result.success && result.signature) {
                    const receivedSol = Number(quote.outAmount) / 1e9;

                    const trade: ITrade = {
                        tokenAddress: ctx.session.tokenCA,
                        tokenName: tokenData.tokenName,
                        tokenSymbol: tokenData.tokenSymbol,
                        buyPrice: tokenPosition.currentPrice,
                        tokenAmount: -tokenAmount, // Negative for sells
                        solSpent: -receivedSol,
                        currentPrice: tokenData.tokenInfo.price,
                        solPnL: 0, // Will be calculated by database
                        usdPnL: 0, // Will be calculated by database
                        entryMarketCap: tokenData.tokenInfo.mktCap,
                        timestamp: new Date()
                    };

                    await userDetails.addTrade(trade);

                    const successMessage = `✅ Sell Successful!\n\n` +
                        `💰 Sold: ${tokenAmount.toFixed(tokenDecimals)} ${tokenData.tokenSymbol}\n` +
                        `🪙 Received: ${receivedSol.toFixed(9)} SOL\n` +
                        `📈 Price Impact: ${(Number(quote.priceImpactPct) || 0).toFixed(2)}%\n` +
                        `🔗 Transaction: [View on Solscan](${result.txUrl})`;

                    const keyboard = Markup.inlineKeyboard([
                        [Markup.button.callback('View Positions', 'positions')],
                        [Markup.button.callback('Main Menu', 'start')]
                    ]);

                    await ctx.reply(successMessage, {
                        parse_mode: 'Markdown',
                        reply_markup: keyboard.reply_markup
                    });
                } else {
                    await ctx.reply(`❌ Transaction failed: ${result.error}`);
                }

            } catch (error) {
                console.error(`Error processing ${percentage}% sell:`, error);
                await ctx.reply('❌ Error processing sell order. Please try again.');
            }
        });
    });

    bot.action('buy_custom', async (ctx) => {
        try {
            if (!ctx.session.tokenCA) {
                await ctx.reply('❌ No token selected. Please select a token first.');
                return;
            }
            ctx.session.awaitingCustomAmount = true;
            await ctx.reply('💰 Enter the amount of SOL you want to spend:');
        } catch (error) {
            console.error('Error in custom amount:', error);
            await ctx.reply('❌ Error processing custom amount. Please try again.');
        }
    });

        // Handle custom amount sells
    bot.action('sell_custom', async (ctx) => {
        try {
            if (!ctx.session.tokenCA) {
                await ctx.reply('❌ No token selected. Please select a token first.');
                return;
            }

            const telegram_id = ctx.from.id.toString();
            const userDetails = await getUser(telegram_id);
            const positions = await userDetails.getPositions();
            
            const tokenPosition = positions.find(p => p.tokenAddress === ctx.session.tokenCA);
            if (!tokenPosition) {
                await ctx.reply('❌ No position found for this token.');
                return;
            }

            ctx.session.awaitingCustomSellAmount = true;
            await ctx.reply(`💰 Enter the amount of ${tokenPosition.tokenSymbol} you want to sell (max: ${tokenPosition.totalTokens}):`);
        } catch (error) {
            console.error('Error in custom sell amount:', error);
            await ctx.reply('❌ Error processing custom amount. Please try again.');
        }
    });

    bot.hears(/^\d*\.?\d+$/, async (ctx) => {
        if (!ctx.session.awaitingCustomAmount) return;

        try {
            const customAmount = parseFloat(ctx.message.text);

            if (isNaN(customAmount) || customAmount <= 0) {
                await ctx.reply('❌ Please enter a valid number greater than 0.');
                return;
            }

            const telegram_id = ctx.from.id.toString();
            const userDetails = await getUser(telegram_id);

            if (userDetails.userBalance < customAmount) {
                await ctx.reply('❌ Insufficient balance. Please add more SOL to your wallet.');
                return;
            }

            await ctx.reply(`🔄 Processing buy order for ${customAmount} SOL...`);

            // Get token info, decimals, and quote
            const tokenData = await scanToken(ctx.session.tokenCA!);
            if (!tokenData) {
                await ctx.reply('❌ Error: Unable to fetch token information.');
                return;
            }

            const tokenDecimals = await getTokenDecimals(ctx.session.tokenCA!);
            const lamports = customAmount * 1e9; // SOL decimals are always 9
            const quote = await getQuote(ctx.session.tokenCA!, true, lamports);

            const result: SwapResult = await executeSwap(
                ctx.session.tokenCA!,
                true,
                lamports,
                userDetails.privateKey
            );

            if (result.success && result.signature) {
                // Calculate received amount using correct token decimals
                const receivedAmount = Number(quote.outAmount) / Math.pow(10, tokenDecimals);

                // Store the trade
                await addTradeToUser(
                    telegram_id,
                    {
                        address: ctx.session.tokenCA!,
                        tokenName: tokenData.tokenName,
                        tokenSymbol: tokenData.tokenSymbol,
                        tokenInfo: {
                            mktCap: tokenData.tokenInfo.mktCap,
                            price: tokenData.tokenInfo.price
                        }
                    },
                    quote,
                    customAmount
                );

                const successMessage = `✅ Trade Successful!\n\n` +
                    `💰 Spent: ${customAmount} SOL\n` +
                    `🪙 Received: ${receivedAmount.toFixed(tokenDecimals)} ${tokenData.tokenSymbol}\n` +
                    `📈 Price Impact: ${(Number(quote.priceImpactPct) || 0).toFixed(2)}%\n` +
                    `🔗 Transaction: [View on Solscan](${result.txUrl})`;

                const keyboard = Markup.inlineKeyboard([
                    [Markup.button.callback('View Positions', 'positions')],
                    [Markup.button.callback('Main Menu', 'start')]
                ]);

                await ctx.reply(successMessage, {
                    parse_mode: 'Markdown',
                    link_preview_options: { is_disabled: true },
                    reply_markup: keyboard.reply_markup
                });
            } else {
                await ctx.reply(`❌ Transaction failed: ${result.error}`);
            }

            ctx.session.awaitingCustomAmount = false;

        } catch (error) {
            console.error('Error processing custom amount:', error);
            await ctx.reply('❌ Error processing buy order. Please try again.');
            ctx.session.awaitingCustomAmount = false;
        }
    });
}

export default swapAction;