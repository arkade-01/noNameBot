import { Telegraf, Markup } from 'telegraf';
import { BotContext } from '../helper_functions/botContext';
import getUser from '../helper_functions/getUserInfo';

// Helper function to escape special characters for MarkdownV2
const escapeMarkdown = (text: string): string => {
    return text.replace(/[_*[\]()~`>#+=|{}.!]/g, '\\$&');
};

// Function to generate the welcome message and keyboard
const generateWelcomeMessage = async (ctx: BotContext, isReturn = false) => {
    const telegram_id = ctx.from?.id.toString() || '';
    const userDetails = await getUser(telegram_id);

    // Format the balance with proper decimal places
    const formattedBalance = userDetails.userBalance.toFixed(4);
    const formattedDate = userDetails.lastUpdatedbalance?.toLocaleString() || 'Never';

    // Create user details section with proper escaping
    const formattedUserDetails = [
        `📜 *Wallet Address:* \`${escapeMarkdown(userDetails.walletAddress)}\``,
        `💰 *Balance:* ${escapeMarkdown(formattedBalance)} SOL`,
        `⏳ *Last Updated:* ${escapeMarkdown(formattedDate)}`
    ].join('\n');

    // Create keyboard
    const keyboard = Markup.inlineKeyboard([
        [
            Markup.button.callback('Trade', 'trade'),
            Markup.button.callback('CopyTrading', 'copy'),
            Markup.button.callback('Positions', 'positions')
        ],
        [
            Markup.button.callback('Wallet', 'wallets'),
            Markup.button.callback('LeaderBoard', 'leaderboard'),
            Markup.button.callback('Help', 'help')
        ],
    ]);

    // Create welcome message with proper escaping
    const welcomeMessage = [
        `🤖 *${isReturn ? 'Welcome back to' : 'Welcome to'} NoNameCabal, ${escapeMarkdown(ctx.from?.first_name || 'Trader')}\\!*`,
        `🚀 Your one\\-stop bot for trading memecoins with speed and precision\\! 💎`,
        '',
        `👤 *User Profile*`,
        formattedUserDetails,
        '',
        `🌟 Use /help to learn how to get started\\.`,
        `📈 Let the gains begin\\!`,
        '',
        `Built with 💻 by @arkade\\_01`
    ].join('\n');

    return { welcomeMessage, keyboard };
};

const startCommand = (bot: Telegraf<BotContext>) => {
    // Regular /start command handler
    bot.start(async (ctx) => {
        try {
            console.log('Start command triggered');
            const { welcomeMessage, keyboard } = await generateWelcomeMessage(ctx);
            await ctx.reply(welcomeMessage, {
                parse_mode: 'MarkdownV2',
                ...keyboard
            });
        } catch (error) {
            console.error('Error in start command:', error);
            await ctx.reply('An error occurred while processing your request.');
        }
    });

    // Action handler for a 'start' callback button
    bot.action('start', async (ctx) => {
        try {
            console.log('Start action triggered');
            await ctx.answerCbQuery(); // Acknowledge the button click
            const { welcomeMessage, keyboard } = await generateWelcomeMessage(ctx, true);

            // Try to edit the current message first
            try {
                await ctx.editMessageText(welcomeMessage, {
                    parse_mode: 'MarkdownV2',
                    ...keyboard
                });
            } catch {
                // If editing fails, send a new message
                await ctx.reply(welcomeMessage, {
                    parse_mode: 'MarkdownV2',
                    ...keyboard
                });
            }
        } catch (error) {
            console.error('Error in start action:', error);
            await ctx.reply('An error occurred while refreshing the menu.');
        }
    });
};

export default startCommand;