import { Telegraf, Markup } from 'telegraf';
import { BotContext } from '../helper_functions/botContext';
import { executeSwap, SwapResult, getQuote } from '../helper_functions/trade';
import getUser from '../helper_functions/getUserInfo';
import scanToken from '../helper_functions/tokenScanner';
import { addTradeToUser } from '../helper_functions/positionManager';
import { Keypair } from "@solana/web3.js";
import { bs58 } from "@project-serum/anchor/dist/cjs/utils/bytes";

const isValidSolanaPrivateKey = (key: string): boolean => {
    try {
        bs58.decode(key);
        return true;
    } catch {
        return false;
    }
};

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

                // Get token info and quote
                const tokenData = await scanToken(ctx.session.tokenCA);
                if (!tokenData) {
                    await ctx.reply('❌ Error: Unable to fetch token information.');
                    return;
                }

                const lamports = amountInSol * 1e9;
                const quote = await getQuote(ctx.session.tokenCA, true, lamports);

                const result: SwapResult = await executeSwap(
                    ctx.session.tokenCA,
                    true,
                    lamports,
                    userDetails.privateKey
                );

                if (result.success && result.signature) {
                    // Store the trade
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
                        quote,
                        amountInSol
                    );

                    const successMessage = `✅ Trade Successful!\n\n` +
                        `💰 Spent: ${amountInSol} SOL\n` +
                        `🪙 Received: ${(Number(quote.outAmount) / 1e9).toFixed(2)} ${tokenData.tokenSymbol}\n` +
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

            // Get token info and quote
            const tokenData = await scanToken(ctx.session.tokenCA!);
            if (!tokenData) {
                await ctx.reply('❌ Error: Unable to fetch token information.');
                return;
            }

            const lamports = customAmount * 1e9;
            const quote = await getQuote(ctx.session.tokenCA!, true, lamports);

            const result: SwapResult = await executeSwap(
                ctx.session.tokenCA!,
                true,
                lamports,
                userDetails.privateKey
            );

            if (result.success && result.signature) {
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
                    `🪙 Received: ${(Number(quote.outAmount) / 1e9).toFixed(2)} ${tokenData.tokenSymbol}\n` +
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
};

export default swapAction;

