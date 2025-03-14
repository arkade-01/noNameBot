import { Telegraf, Context } from 'telegraf';
import { Markup } from 'telegraf';

const helpCommand = (bot: Telegraf<Context>) => {
    // Create a constant for the help message to avoid duplication
    const createHelpMessage = (firstName: string) => {
        return `👋 Hello, ${firstName || 'User'}!

Welcome to Cop Trading Bot - your trading companion on Solana!

🔹 *Commands*:
• /start - Start the bot and view your dashboard
• /help - View this help message
• /trade - Start trading tokens
• /positions - View your current positions

🔹 *Features*:
• Fast token swaps.
• Portfolio tracking and analytics
• Copy trading from top traders
• Leaderboard system to track performance

🔹 *Getting Started*:
1. Use the Wallet section to set up your wallet
2. Check your positions in the Positions tab
3. Use the Trade button to swap tokens
4. Use CopyTrading to follow top traders

🔹 *Join Our Community*:
Stay updated with the latest features and announcements!`;
    };

    // Create a constant for the keyboard with social links
    const socialLinksKeyboard = Markup.inlineKeyboard([
        [
            Markup.button.url('Twitter', 'https://x.com/copbotai?s=21'),
            Markup.button.url('Telegram Channel', 'https://t.me/Copbotai')
        ],
        [
            Markup.button.callback('Back to Menu', 'start')
        ]
    ]);

    // Handler for the 'help' button action
    bot.action('help', async (ctx) => {
        try {
            await ctx.answerCbQuery(); // Acknowledge the button click

            const helpMessage = createHelpMessage(ctx.from?.first_name);

            // Try to edit the current message first
            try {
                await ctx.editMessageText(helpMessage, {
                    parse_mode: 'Markdown',
                    ...socialLinksKeyboard
                });
            } catch {
                // If editing fails, send a new message
                await ctx.reply(helpMessage, {
                    parse_mode: 'Markdown',
                    ...socialLinksKeyboard
                });
            }
        } catch (error) {
            console.error('Error in help command:', error);
            await ctx.reply('An error occurred while displaying help information.');
        }
    });

    // Handler for the /help command
    bot.command('help', async (ctx) => {
        try {
            const helpMessage = createHelpMessage(ctx.from?.first_name);

            await ctx.reply(helpMessage, {
                parse_mode: 'Markdown',
                ...socialLinksKeyboard
            });
        } catch (error) {
            console.error('Error in help command:', error);
            await ctx.reply('An error occurred while displaying help information.');
        }
    });
};

export default helpCommand;