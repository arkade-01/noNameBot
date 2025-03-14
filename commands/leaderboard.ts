import { Telegraf } from "telegraf";
import { BotContext } from "../helper_functions/botContext";
import User from '../models/schema';
import { getPortfolioSummary } from '../helper_functions/positionManager';

// Define interface for leaderboard entry
interface LeaderboardEntry {
  telegram_id: string;
  username?: string;
  totalUsdSpent: number;
  currentUsdValue: number;
  totalUsdPnL: number;
  pnlPercentage: number;
  numberOfPositions: number;
}

const Leaderboard = (bot: Telegraf<BotContext>) => {
  // Handle the leaderboard action
  bot.action('leaderboard', async (ctx) => {
    try {
      await ctx.answerCbQuery(); // Answer the callback query to stop loading state
      await displayLeaderboard(ctx);
    } catch (error) {
      console.error('Error in leaderboard action:', error);
      await ctx.reply('Error fetching leaderboard data. Please try again later.');
    }
  });

  // Also add command handler for /leaderboard
  bot.command('leaderboard', async (ctx) => {
    try {
      await displayLeaderboard(ctx);
    } catch (error) {
      console.error('Error in leaderboard command:', error);
      await ctx.reply('Error fetching leaderboard data. Please try again later.');
    }
  });

  // Function to display the leaderboard
  async function displayLeaderboard(ctx: BotContext) {
    await ctx.reply('Fetching leaderboard data... This may take a moment.');

    try {
      // Get all users from database
      const users = await User.find({});

      if (users.length === 0) {
        return await ctx.reply('No traders found yet. Be the first one to make a trade!');
      }

      // Calculate portfolio summary for each user
      const leaderboardData: LeaderboardEntry[] = await Promise.all(
        users.map(async (user) => {
          try {
            // Skip users without positions
            if (!user.positions || user.positions.length === 0) {
              return {
                telegram_id: user.telegram_id,
                username: ctx.from?.username === user.telegram_id ? ctx.from?.username : undefined,
                totalUsdSpent: 0,
                currentUsdValue: 0,
                totalUsdPnL: 0,
                pnlPercentage: 0,
                numberOfPositions: 0
              };
            }

            const summary = await getPortfolioSummary(user.telegram_id);

            // Calculate PnL percentage
            const pnlPercentage = summary.totalUsdSpent > 0
              ? (summary.totalUsdPnL / summary.totalUsdSpent) * 100
              : 0;

            return {
              telegram_id: user.telegram_id,
              // Try to get username if it's the current user
              username: ctx.from?.username === user.telegram_id ? ctx.from?.username : undefined,
              totalUsdSpent: summary.totalUsdSpent,
              currentUsdValue: summary.currentUsdValue,
              totalUsdPnL: summary.totalUsdPnL,
              pnlPercentage,
              numberOfPositions: summary.numberOfPositions
            };
          } catch (error) {
            console.error(`Error calculating portfolio for user ${user.telegram_id}:`, error);
            // Return placeholder data for users with errors
            return {
              telegram_id: user.telegram_id,
              totalUsdSpent: 0,
              currentUsdValue: 0,
              totalUsdPnL: 0,
              pnlPercentage: 0,
              numberOfPositions: 0
            };
          }
        })
      );

      // Filter out users with no positions
      const activeTraders = leaderboardData.filter(trader => trader.numberOfPositions > 0);

      if (activeTraders.length === 0) {
        return await ctx.reply('No active traders found yet. Be the first one to make a trade!');
      }

      // Sort by PnL percentage (highest first)
      const sortedLeaderboard = activeTraders.sort((a, b) => b.pnlPercentage - a.pnlPercentage);

      // Get top 10 traders
      const topTraders = sortedLeaderboard.slice(0, 10);

      // Format the leaderboard message
      let message = '🏆 *TOP TRADERS LEADERBOARD* 🏆\n\n';

      topTraders.forEach((trader, index) => {
        // Determine emoji based on rank
        let rankEmoji = '';
        if (index === 0) rankEmoji = '🥇';
        else if (index === 1) rankEmoji = '🥈';
        else if (index === 2) rankEmoji = '🥉';
        else rankEmoji = `${index + 1}.`;

        // Format values
        const pnlSign = trader.pnlPercentage >= 0 ? '+' : '';
        const pnlPercentage = `${pnlSign}${trader.pnlPercentage.toFixed(2)}%`;
        const pnlValue = `${trader.totalUsdPnL >= 0 ? '+' : ''}$${trader.totalUsdPnL.toFixed(2)}`;

        // Add trader info to message
        message += `${rankEmoji} *${trader.username || `User_${index + 1}`}*\n`;
        message += `   ROI: *${pnlPercentage}* (${pnlValue})\n`;
        message += `   Portfolio: $${trader.currentUsdValue.toFixed(2)} (${trader.numberOfPositions} positions)\n\n`;
      });

      // Find the current user's rank if they exist in the leaderboard
      const currentUserTelegramId = ctx.from?.id.toString();
      const currentUserRank = sortedLeaderboard.findIndex(
        trader => trader.telegram_id === currentUserTelegramId
      );

      if (currentUserRank !== -1) {
        const currentUserData = sortedLeaderboard[currentUserRank];
        message += `\n*Your Rank: ${currentUserRank + 1} / ${sortedLeaderboard.length}*\n`;
        message += `ROI: ${currentUserData.pnlPercentage >= 0 ? '+' : ''}${currentUserData.pnlPercentage.toFixed(2)}%\n`;
        message += `Portfolio: $${currentUserData.currentUsdValue.toFixed(2)}\n`;
      }

      // Add timestamp and refresh button
      message += `\n_Updated: ${new Date().toLocaleString()}_`;

      await ctx.reply(message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔄 Refresh Leaderboard', callback_data: 'leaderboard' }],
            [{ text: '📊 My Portfolio', callback_data: 'portfolio' }]
          ]
        }
      });
    } catch (error) {
      console.error('Error displaying leaderboard:', error);
      await ctx.reply('Error generating leaderboard. Please try again later.');
    }
  }
};

export default Leaderboard;