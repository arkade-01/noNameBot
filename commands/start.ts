import { Telegraf, Context } from 'telegraf';
import getUser from '../helper_functions/getUserInfo';

const startCommand = (bot: Telegraf<Context>) => {
    bot.start(async (ctx) => {
        const telegram_id = ctx.from?.id.toString() || '';
        const userDetails = await getUser(telegram_id);

        // Format user details for the welcome message
        const formattedUserDetails = `
📜 **Wallet Address:** \`${userDetails.walletAddress}\`
💰 **Balance:** ${userDetails.userBalance.toFixed(4)} SOL
⏳ **Last Updated:** ${userDetails.lastUpdatedbalance?.toLocaleString() || 'Never'
            }
        `;

        const welcomeMessage = `
🤖 **Welcome to NoNameCabal, ${ctx.from?.first_name || 'Trader'}!**
🚀 Your one-stop bot for trading memecoins with speed and precision! 💎

👤 **User Profile**
${formattedUserDetails}

🌟 Use /help to learn how to get started.
📈 Let the gains begin!
        `;

        ctx.reply(welcomeMessage, { parse_mode: 'Markdown' });
    });
};

export default startCommand;
