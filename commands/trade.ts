import { Telegraf, Markup } from 'telegraf';
import { BotContext } from '../helper_functions/botContext';
import scanToken from '../helper_functions/tokenScanner';
import { getQuote } from '../helper_functions/trade';
import getUser from '../helper_functions/getUserInfo';

const escapeMarkdown = (text: any): string => {
    // If text is null or undefined, return empty string
    if (text == null) return '';

    // Convert to string if it's not already
    const stringText = String(text);
    return stringText.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
};

const formatTokenResponse = async (data: any, quote: any, telegram_id: string, amount: number = 1) => {
    // Convert values to strings before escaping
    const name = escapeMarkdown(data?.tokenName || '');
    const symbol = escapeMarkdown(data?.tokenSymbol || '');
    const address = escapeMarkdown(data?.address || '');
    const marketCap = escapeMarkdown((data?.marketCap || 0).toLocaleString());
    const price = escapeMarkdown(data?.tokenInfo?.price?.toString() || '0');
    const supply = escapeMarkdown((data?.tokenInfo?.supplyAmount || 0).toLocaleString());
    const score = escapeMarkdown((data?.score || 0).toString());
    const userDetails = await getUser(telegram_id);

    let baseResponse = `🔍 Token Analysis

📝 Name: ${name} \\(${symbol}\\)
🏦 Contract: ${address}
💰 Market Cap: $${marketCap}
💎 Price: $${price}
📊 Supply: ${supply}
⭐ Score: ${score}/100

🛡️ Security Checks:
✅ Mint Function: ${data.auditRisk.mintDisabled ? 'Disabled' : 'Enabled'}
✅ Freeze Function: ${data.auditRisk.freezeDisabled ? 'Disabled' : 'Enabled'}
✅ LP Status: ${data.auditRisk.lpBurned ? 'Burned' : 'Not Burned'}`;

    if (quote && !quote.error) {
        const tokensReceived = escapeMarkdown((Number(quote.outAmount) / 1e9).toString());
        const slippage = escapeMarkdown((quote.slippageBps / 100).toString());
        const impact = escapeMarkdown((Number(quote.priceImpactPct) || 0).toFixed(2));
        const balance = escapeMarkdown(userDetails.userBalance.toFixed(4));
        const solAmount = escapeMarkdown(amount.toString());

        baseResponse += `\n\n💱 Quote Info:

💰 Balance: ${balance} SOL
${solAmount} SOL ➜ ${tokensReceived} ${symbol}
⚠️ Slippage: ${slippage}%
📊 Price Impact: ${impact}%`;
    }

    return baseResponse;
};

const tradeCommand = (bot: Telegraf<BotContext>) => {
    bot.on('text', async (ctx) => {
        if (!ctx.from || ctx.message.text.match(/^\$?\d+\.?\d*$/)) return;

        try {
            const tokenCA = ctx.message.text;
            const telegram_id = ctx.from.id.toString();

            if (!tokenCA.match(/^[A-Za-z0-9]{32,44}$/)) {
                await ctx.reply('Please provide a valid Solana token address\\.');
                return;
            }

            // Store tokenCA in session
            ctx.session.tokenCA = tokenCA;

            const tokenData = await scanToken(tokenCA);
            if (!tokenData) {
                await ctx.reply('Token not found or invalid address\\.');
                return;
            }

            let quote;
            try {
                const demam = 1 * 1e9;
                quote = await getQuote(tokenCA, true, demam);
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
                    Markup.button.callback('Custom Amount', 'buy_custom'),
                    Markup.button.callback('Buy', 'buy')
                ],
                [Markup.button.callback('Main Menu', 'start')]
            ]);

            await ctx.reply(formattedResponse, {
                parse_mode: "MarkdownV2",
                ...keyboard
            });
        } catch (error: any) {
            console.error('Error scanning token:', error);

            if (error.response?.status === 404) {
                await ctx.reply('Token not found\\. Please check the address and try again\\.');
            } else {
                await ctx.reply('An error occurred while scanning the token\\. Please try again later\\.');
            }
        }
    });

    bot.action("trade", async (ctx) => {
        try {
            await ctx.reply('Please send me a token address to scan\\.');
        } catch (error) {
            console.error('Error in trade action:', error);
            await ctx.reply('Sorry, something went wrong\\. Please try again\\.');
        }
    });
};

export default tradeCommand;