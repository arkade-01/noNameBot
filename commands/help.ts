import { Telegraf, Context } from 'telegraf';

const helpCommand = (bot: Telegraf<Context>) => {
    bot.action('help', async (ctx) => {
        const welcomeMessage = `👋 Hello, ${ctx.from?.first_name || 'User'}!
        
Welcome to the bot. Use /help to learn what I can do for you!`;

        ctx.reply(welcomeMessage);
    });
};

export default helpCommand;
