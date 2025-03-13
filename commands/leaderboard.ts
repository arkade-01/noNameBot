import { Telegraf } from "telegraf";
import { BotContext } from "../helper_functions/botContext";


const Leaderboard = (bot: Telegraf<BotContext>) => {
  bot.action('leaderboard', async (ctx) => {
    await ctx.reply('Welcome to the Top Traders LeaderBoard')
  })
}

export default Leaderboard;