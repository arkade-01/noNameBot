import { Telegraf, Context, Markup } from 'telegraf';
import getUser from '../helper_functions/getUserInfo';

const startCommand = (bot: Telegraf<Context>) => {
    bot.start(async (ctx) => {
        try {
            const telegram_id = ctx.from?.id.toString() || '';
            const userDetails = await getUser(telegram_id);

            // Format user details for the welcome message
            const formattedUserDetails = `
📜 **Wallet Address:** \`${userDetails.walletAddress}\`
💰 **Balance:** ${userDetails.userBalance.toFixed(4)} SOL
⏳ **Last Updated:** ${userDetails.lastUpdatedbalance?.toLocaleString() || 'Never'}
            `;

            const keyboard = Markup.inlineKeyboard([
                [Markup.button.callback('Wallet', 'wallets')],
                [Markup.button.callback('Help', 'help')],
                [Markup.button.callback('Trade', 'trade')],
            ]);

            const welcomeMessage = `
🤖 **Welcome to NoNameCabal, ${ctx.from?.first_name || 'Trader'}!**
🚀 Your one-stop bot for trading memecoins with speed and precision! 💎

👤 **User Profile**
${formattedUserDetails}

🌟 Use /help to learn how to get started.
📈 Let the gains begin!
            `;

            await ctx.reply(welcomeMessage, {
                parse_mode: 'Markdown',
                ...keyboard
            });
        } catch (error) {
            console.error('Error in start command:', error);
            await ctx.reply('An error occurred while processing your request.');
        }
    });
};

export default startCommand;