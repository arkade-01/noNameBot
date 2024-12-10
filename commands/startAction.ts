import { Telegraf, Context, Markup } from 'telegraf';
import getUser from '../helper_functions/getUserInfo';

// Helper function to escape special characters for Markdown
const escapeMarkdown = (text: string): string => {
    // Characters that need to be escaped in Markdown (not MarkdownV2):
    // '_', '*', '[', ']', '(', ')', '~', '`', '>'
    return text.replace(/[_*[\]()~`>]/g, '\\$&');
};

const startAction = (bot: Telegraf<Context>) => {
    bot.action("start", async (ctx) => {
        try {
            const telegram_id = ctx.from?.id.toString() || '';
            const userDetails = await getUser(telegram_id);

            // Format the balance and date
            const formattedBalance = userDetails.userBalance.toFixed(4);
            const formattedDate = userDetails.lastUpdatedbalance?.toLocaleString() || 'Never';

            // Format user details with proper escaping
            const formattedUserDetails = [
                `📜 *Wallet Address:* \`${escapeMarkdown(userDetails.walletAddress)}\``,
                `💰 *Balance:* ${escapeMarkdown(formattedBalance)} SOL`,
                `⏳ *Last Updated:* ${escapeMarkdown(formattedDate)}`
            ].join('\n');

            // Create keyboard
            const keyboard = Markup.inlineKeyboard([
                [
                    Markup.button.callback('Trade', 'trade'),
                    Markup.button.callback('Positions', 'positions')
                ],
                [
                    Markup.button.callback('Wallet', 'wallets'),
                    Markup.button.callback('Help', 'help')
                ]
            ]);

            // Create welcome message with proper escaping
            const welcomeMessage = [
                `🤖 *Welcome to NoNameCabal, ${escapeMarkdown(ctx.from?.first_name || 'Trader')}!*`,
                `🚀 Your one-stop bot for trading memecoins with speed and precision! 💎`,
                '',
                `👤 *User Profile*`,
                formattedUserDetails,
                '',
                `🌟 Use /help to learn how to get started.`,
                `📈 Let the gains begin!`,
                '',
                `Built with 💻 by @arkade\\_01`
            ].join('\n');

            // Edit the existing message instead of sending a new one
            await ctx.editMessageText(welcomeMessage, {
                parse_mode: 'Markdown',  // Using regular Markdown instead of MarkdownV2
                reply_markup: keyboard.reply_markup
            });

        } catch (error) {
            console.error('Error in start action:', error);
            // Use answerCbQuery to show an error message without sending a new message
            await ctx.answerCbQuery('An error occurred while processing your request.');
        }
    });
};

export default startAction;