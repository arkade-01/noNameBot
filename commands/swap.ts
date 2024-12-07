import { Telegraf } from 'telegraf';
import { BotContext } from '../helper_functions/botContext';
import { executeSwap, SwapResult } from '../helper_functions/trade';
import getUser from '../helper_functions/getUserInfo';
import { Keypair } from "@solana/web3.js";
import { bs58 } from "@project-serum/anchor/dist/cjs/utils/bytes";

const isValidSolanaPrivateKey = (key: string): boolean => {
    try {
        // Attempt to decode the base58 private key
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

                const result: SwapResult = await executeSwap(
                    ctx.session.tokenCA,
                    true,
                    amountInSol * 1e9,
                    userDetails.privateKey
                );
                // console.log(result)

                if (result.success) {
                    await ctx.reply(`✅ Transaction successful!\n\nView transaction: ${result.txUrl}`);
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

            // if (!userDetails.privateKey || !isValidSolanaPrivateKey(userDetails.privateKey)) {
            //     await ctx.reply('❌ Invalid Solana wallet configuration. Please check your wallet setup.');
            //     return;
            // }

            if (userDetails.userBalance < customAmount) {
                await ctx.reply('❌ Insufficient balance. Please add more SOL to your wallet.');
                return;
            }

            await ctx.reply(`🔄 Processing buy order for ${customAmount} SOL...`);

            const result: SwapResult = await executeSwap(
                ctx.session.tokenCA!,
                true,
                customAmount * 1e9,
                userDetails.privateKey
            );

            if (result.success) {
                await ctx.reply(`✅ Transaction successful!\n\nView transaction: ${result.txUrl}`);
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