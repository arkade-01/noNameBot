import { Telegraf, Context } from 'telegraf';
import getUser from '../helper_functions/getUserInfo';

const startCommand = (bot: Telegraf<Context>) => {
    bot.start(async (ctx) => {
        const telegram_id = ctx.from?.id.toString() || '';
        const userDetails = await getUser(telegram_id)
        const welcomeMessage = `👋 Hello, ${ctx.from?.first_name || 'User'}!
        
        ${userDetails}`;

        ctx.reply(welcomeMessage);
    });
};

export default startCommand;
