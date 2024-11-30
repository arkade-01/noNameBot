import { Telegraf, Context, Markup } from 'telegraf';
import scanToken from '../helper_functions/tokenScanner';

const formatTokenResponse = (data: any) => {
    return `🔍 Token Analysis

📝 Name: ${data.tokenName} (${data.tokenSymbol})
🏦 Contract: ${data.address}
💰 Market Cap: $${data.marketCap.toLocaleString()}
💎 Price: $${data.tokenInfo.price}
📊 Supply: ${data.tokenInfo.supplyAmount.toLocaleString()}
⭐ Score: ${data.score}/100

🛡️ Security Checks:
✅ Mint Function: ${data.auditRisk.mintDisabled ? 'Disabled' : 'Enabled'}
✅ Freeze Function: ${data.auditRisk.freezeDisabled ? 'Disabled' : 'Enabled'}
✅ LP Status: ${data.auditRisk.lpBurned ? 'Burned' : 'Not Burned'}`;
};

const tradeCommand = (bot: Telegraf<Context>) => {
    bot.on('text', async (ctx) => {
        if (!ctx.from) return;

        // Skip if message is just a number
        if (ctx.message.text.match(/^\$?\d+\.?\d*$/)) {
            return;
        }

        try {
            const address = ctx.message.text;
            const tokenData = await scanToken(address);
            const formattedResponse = formatTokenResponse(tokenData);

            await ctx.reply(formattedResponse);
        } catch (error) {
            console.error('Error scanning token:', error);
            await ctx.reply('Sorry, there was an error scanning that token address. Please check the address and try again.');
        }
    });

    bot.action("trade", async (ctx) => {
        try {
            await ctx.reply('Please send me a token address to scan.');
        } catch (error) {
            console.error('Error in trade action:', error);
            await ctx.reply('Sorry, something went wrong. Please try again.');
        }
    });
};

export default tradeCommand;