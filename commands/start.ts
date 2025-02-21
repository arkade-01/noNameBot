import { Telegraf, Context, Markup } from 'telegraf';
import getUser from '../helper_functions/getUserInfo';

// Helper function to escape special characters for MarkdownV2 (except formatting chars)
const escapeMarkdown = (text: string): string => {
    // First, escape characters that need escaping
    return text.replace(/[_*[\]()~`>#+=|{}.!]/g, '\\$&');
};

const startCommand = (bot: Telegraf<Context>) => {
    bot.start(async (ctx) => {
        try {
            const telegram_id = ctx.from?.id.toString() || '';
            const userDetails = await getUser(telegram_id);

            // Format the balance with proper decimal places
            const formattedBalance = userDetails.userBalance.toFixed(4);
            // Escape each individual part before formatting
            const escapedBalance = escapeMarkdown(formattedBalance);
            const escapedDate = escapeMarkdown(userDetails.lastUpdatedbalance?.toLocaleString() || 'Never');
            const escapedWalletAddress = escapeMarkdown(userDetails.walletAddress);
            const escapedName = escapeMarkdown(ctx.from?.first_name || 'Trader');

            // Build message with pre-escaped individual parts and proper line spacing
            const welcomeMessage = [
                `🤖 *Welcome to BOLT TRADING BOT, ${escapedName}\\!*`,
                ``,
                `🚀 Ready to enhance your trading with market insights, early token alerts, and automated tools\\.`,
                ``,
                `👤 *User Profile*`,
                `📜 *Wallet Address:* \`${escapedWalletAddress}\``,
                `💰 *Balance:* ${escapedBalance} SOL`,
                `⏳ *Last Updated:* ${escapedDate}`,
                ``,
                `🌟 Type /help to get started with our features\\.`,
                `📈 Successful trading awaits\\!`
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
                ],
            ]);

            await ctx.reply(welcomeMessage, {
                parse_mode: 'MarkdownV2',
                ...keyboard
            });
        } catch (error) {
            console.error('Error in start command:', error);
            await ctx.reply('An error occurred while processing your request\\.', {
                parse_mode: 'MarkdownV2'
            });
        }
    });
};

export default startCommand;