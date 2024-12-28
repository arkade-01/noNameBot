import { Telegraf, Markup } from 'telegraf';
import { BotContext } from '../helper_functions/botContext';
import scanToken from '../helper_functions/tokenScanner';
import { getQuote } from '../helper_functions/trade';
import getUser from '../helper_functions/getUserInfo';

const escapeMarkdown = (text: any): string => {
    if (text == null) return '';
    const stringText = String(text);
    return stringText.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
};

const formatTokenResponse = async (data: any, quote: any, telegram_id: string, amount: number = 1) => {
    const name = escapeMarkdown(data?.tokenName || '');
    const symbol = escapeMarkdown(data?.tokenSymbol || '');
    const address = escapeMarkdown(data?.address || '');
    const marketCap = escapeMarkdown((data?.tokenInfo?.mktCap || 0).toLocaleString());
    const price = escapeMarkdown(data?.tokenInfo?.price?.toString() || '0');
    const supply = escapeMarkdown((data?.tokenInfo?.supplyAmount || 0).toLocaleString());
    const score = escapeMarkdown((data?.score || 0).toString());
    const userDetails = await getUser(telegram_id);

    let baseResponse = `🔍 Token Analysis\n\n` +
        `📝 Name: ${name} \\(${symbol}\\)\n` +
        `🏦 Contract: ${address}\n` +
        `💰 Market Cap: $${marketCap}\n` +
        `💎 Price: $${price}\n` +
        `📊 Supply: ${supply}\n` +
        `⭐ Score: ${score}/100\n\n` +
        `🛡️ Security Checks:\n` +
        `✅ Mint Function: ${data.auditRisk.mintDisabled ? 'Disabled' : 'Enabled'}\n` +
        `✅ Freeze Function: ${data.auditRisk.freezeDisabled ? 'Disabled' : 'Enabled'}\n` +
        `✅ LP Status: ${data.auditRisk.lpBurned ? 'Burned' : 'Not Burned'}`;

    if (quote && !quote.error) {
        const tokensReceived = escapeMarkdown((Number(quote.outAmount) / 1e9).toString());
        const slippage = escapeMarkdown((quote.slippageBps / 100).toString());
        const impact = escapeMarkdown((Number(quote.priceImpactPct) || 0).toFixed(2));
        const balance = escapeMarkdown(userDetails.userBalance.toFixed(4));
        const solAmount = escapeMarkdown(amount.toString());

        baseResponse += `\n\n💱 Quote Info:\n\n` +
            `💰 Balance: ${balance} SOL\n` +
            `${solAmount} SOL ➜ ${tokensReceived} ${symbol}\n` +
            `⚠️ Slippage: ${slippage}%\n` +
            `📊 Price Impact: ${impact}%`;
    }

    return baseResponse;
};

const tradeCommand = (bot: Telegraf<BotContext>) => {
    // Handle the trade action from main menu
    bot.action('trade', async (ctx) => {
        try {
            // Answer the callback query
            await ctx.answerCbQuery();

            // Delete the previous message
            if (ctx.callbackQuery && 'message' in ctx.callbackQuery) {
                await ctx.deleteMessage();
            }

            // Simple welcome message for trade
            const message = `*Welcome to the Trade Menu* 🚀\n\n` +
                `Please enter a Solana token address to start trading\\.`;

            // Simple keyboard with just the back button
            const keyboard = Markup.inlineKeyboard([
                [Markup.button.callback('Back to Main Menu', 'start')]
            ]);

            await ctx.reply(message, {
                parse_mode: 'MarkdownV2',
                ...keyboard
            });
        } catch (error) {
            console.error('Error in trade action:', error);
            await ctx.answerCbQuery('An error occurred. Please try again.');
        }
    });

    // Handle text messages for token addresses
    bot.on('text', async (ctx) => {
        // Ignore if the message is a command
        if (ctx.message.text.startsWith('/')) return;

        // Ignore if there's no sender or if the text is just a number
        if (!ctx.from || ctx.message.text.match(/^\$?\d+\.?\d*$/)) return;

        try {
            const tokenCA = ctx.message.text;
            const telegram_id = ctx.from.id.toString();

            if (!tokenCA.match(/^[A-Za-z0-9]{32,44}$/)) {
                await ctx.reply('Please provide a valid Solana token address.');
                return;
            }

            ctx.session.tokenCA = tokenCA;

            const tokenData = await scanToken(tokenCA);
            if (!tokenData) {
                await ctx.reply('Token not found or invalid address.');
                return;
            }

            let quote;
            try {
                quote = await getQuote(tokenCA, true, 1e9); // Quote for 1 SOL
            } catch (error) {
                console.error('Error fetching quote:', error);
                quote = { error: true };
            }

            const formattedResponse = await formatTokenResponse(tokenData, quote, telegram_id);

            const keyboard = Markup.inlineKeyboard([
                [
                    Markup.button.callback('0.1 SOL', 'buy_0.1'),
                    Markup.button.callback('0.5 SOL', 'buy_0.5'),
                    Markup.button.callback('1 SOL', 'buy_1')
                ],
                [
                    Markup.button.callback('2 SOL', 'buy_2'),
                    Markup.button.callback('5 SOL', 'buy_5'),
                    Markup.button.callback('10 SOL', 'buy_10')
                ],
                [
                    Markup.button.callback('Custom Amount', 'buy_custom')
                ],
                [Markup.button.callback('Back to Trade Menu', 'trade')]
            ]);

            await ctx.reply(formattedResponse, {
                parse_mode: "MarkdownV2",
                reply_markup: keyboard.reply_markup
            });

        } catch (error) {
            console.error('Error scanning token:', error);
            await ctx.reply('An error occurred while scanning the token. Please try again.');
        }
    });

    // Add handler for /trade command
    bot.command('trade', async (ctx) => {
        await ctx.reply('Please enter a Solana token address to trade.');
    });
};

export default tradeCommand;