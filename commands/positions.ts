import { BotContext } from "../helper_functions/botContext";
import { Telegraf, Markup } from 'telegraf';
import { IPosition } from '../models/schema';
import { updatePositionsPnL, getPortfolioSummary } from '../helper_functions/positionManager';
import { fetchSolanaPrice, fetchSolanaPriceWithCache } from "../helper_functions/fetchSolprice";

// Helper functions remain the same
function formatNumber(num: number, decimals: number = 2): string {
    return num.toFixed(decimals);
}

function formatUSD(amount: number): string {
    return `$${formatNumber(amount)}`;
}

function calculatePercentageChange(current: number, original: number): number {
    return ((current - original) / original) * 100;
}

function getPnLEmoji(pnl: number): string {
    return pnl >= 0 ? '🟩' : '🟥';
}

function formatPosition(position: IPosition, solPrice: number): string {
    const marketCap = position.currentPrice * position.totalTokens * solPrice;
    const avgEntryInUsd = position.averageBuyPrice * solPrice;
    const pnlPercentage = calculatePercentageChange(
        position.currentPrice,
        position.averageBuyPrice
    );

    const solPnlPercentage = calculatePercentageChange(
        position.solPnL + position.totalSolSpent,
        position.totalSolSpent
    );

    return `${position.tokenSymbol} - 📈 - ${formatNumber(position.solPnL)} SOL (${formatUSD(position.usdPnL)})
${position.tokenAddress}
• Price & MC: ${formatUSD(position.currentPrice * solPrice)} — ${(marketCap)}
• Avg Entry: ${(avgEntryInUsd)} — ${(avgEntryInUsd * position.totalTokens)}
• Balance: ${formatNumber(position.totalTokens, 2)}K
• Buys: ${formatNumber(position.totalSolSpent)} SOL (${formatUSD(position.totalSolSpent * solPrice)}) • (${position.trades.length} buys)
• Sells: N/A • (0 sells)
• PNL USD: ${formatNumber(pnlPercentage)}% (${formatUSD(position.usdPnL)}) ${getPnLEmoji(position.usdPnL)}
• PNL SOL: ${formatNumber(solPnlPercentage)}% (${formatNumber(position.solPnL)} SOL) ${getPnLEmoji(position.solPnL)}`;
}

interface UserPreferences {
    hideZeroBalances: boolean;
}

const userPreferences = new Map<string, UserPreferences>();

export const positionsCommand = (bot: Telegraf<BotContext>) => {
    async function displayPositions(
        ctx: any,
        telegram_id: string,
        preferences: UserPreferences = { hideZeroBalances: false }
    ) {
        const positions = await updatePositionsPnL(telegram_id);
        const summary = await getPortfolioSummary(telegram_id);
        const solPrice = await fetchSolanaPriceWithCache();

        const filteredPositions = preferences.hideZeroBalances
            ? positions.filter(pos => pos.totalTokens > 0)
            : positions;

        const header = `📊 Portfolio Overview
Tokens: ${filteredPositions.length}/${positions.length}
Balance: ${formatNumber(summary.totalSolSpent)} SOL (${formatUSD(summary.totalSolSpent * solPrice)})
Positions: ${formatNumber(summary.totalSolPnL + summary.totalSolSpent)} SOL (${formatUSD((summary.totalSolPnL + summary.totalSolSpent) * solPrice)})
Last Update: ${new Date().toLocaleTimeString()}`;

        const positionStrings = filteredPositions.map(pos => formatPosition(pos, solPrice));
        const message = [header, ...positionStrings].join('\n\n');
        const footer = '💡 Click a token symbol to access the token\'s sell menu.';

        const hideZeroLabel = preferences.hideZeroBalances ? 'Show All Balances' : 'Hide Zero Balances';

        return ctx.reply(`${message}\n\n${footer}`, {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('🔄 Refresh Prices', 'update_prices')],
                [Markup.button.callback(`👁 ${hideZeroLabel}`, 'toggle_zero_balances')],
                [Markup.button.callback('⬅️ Back to Menu', 'start')]
            ])
        });
    }

    // Handle /positions command
    bot.command('positions', async (ctx) => {
        console.log('Positions command received');
        try {
            const telegram_id = ctx.from?.id.toString();
            if (!telegram_id) {
                await ctx.reply('Error: Could not identify user');
                return;
            }

            const prefs = userPreferences.get(telegram_id) || { hideZeroBalances: false };
            await displayPositions(ctx, telegram_id, prefs);

        } catch (error) {
            console.error('Error in positions command:', error);
            await ctx.reply('❌ Error fetching positions. Please try again later.');
        }
    });

    // Handle positions button click
    bot.action('positions', async (ctx) => {
        try {
            await ctx.answerCbQuery();
            const telegram_id = ctx.from?.id.toString();
            if (!telegram_id) {
                await ctx.reply('Error: Could not identify user');
                return;
            }

            if (ctx.callbackQuery && 'message' in ctx.callbackQuery) {
                await ctx.deleteMessage();
            }

            const prefs = userPreferences.get(telegram_id) || { hideZeroBalances: false };
            await displayPositions(ctx, telegram_id, prefs);

        } catch (error) {
            console.error('Error in positions action:', error);
            await ctx.reply('❌ Error updating positions. Please try again later.');
        }
    });

    // Update prices handler
    bot.action('update_prices', async (ctx) => {
        try {
            await ctx.answerCbQuery('🔄 Updating prices...');
            const telegram_id = ctx.from?.id.toString();
            if (!telegram_id) {
                throw new Error('Could not identify user');
            }

            if (ctx.callbackQuery && 'message' in ctx.callbackQuery) {
                await ctx.deleteMessage();
            }

            const prefs = userPreferences.get(telegram_id) || { hideZeroBalances: false };
            await displayPositions(ctx, telegram_id, prefs);

        } catch (error) {
            console.error('Error updating prices:', error);
            await ctx.answerCbQuery('❌ Error updating prices. Please try again.');
        }
    });

    // Toggle zero balances handler
    bot.action('toggle_zero_balances', async (ctx) => {
        try {
            const telegram_id = ctx.from?.id.toString();
            if (!telegram_id) {
                throw new Error('Could not identify user');
            }

            // Toggle the preference
            const currentPrefs = userPreferences.get(telegram_id) || { hideZeroBalances: false };
            const newPrefs = {
                ...currentPrefs,
                hideZeroBalances: !currentPrefs.hideZeroBalances
            };
            userPreferences.set(telegram_id, newPrefs);

            const statusText = newPrefs.hideZeroBalances ?
                'Hiding zero balances' :
                'Showing all balances';
            await ctx.answerCbQuery(`👁 ${statusText}`);

            if (ctx.callbackQuery && 'message' in ctx.callbackQuery) {
                await ctx.deleteMessage();
            }

            await displayPositions(ctx, telegram_id, newPrefs);

        } catch (error) {
            console.error('Error toggling zero balances:', error);
            await ctx.answerCbQuery('❌ Error updating display preferences. Please try again.');
        }
    });
};


// // commands/positions.ts
// import { BotContext } from "../helper_functions/botContext";
// import { Telegraf } from 'telegraf';

// const positionsCommand = (bot: Telegraf<BotContext>) => {
//     console.log('Registering positions command...'); // Debug log

//     bot.command('positions', async (ctx) => {
//         console.log('Positions command received');
//         await ctx.reply('Positions command received - working on implementing the full functionality');
//     });

//     bot.action('positions', async (ctx) => {
//         console.log('Positions action received');
//         await ctx.answerCbQuery();
//         await ctx.reply('Positions action received - working on implementing the full functionality');
//     });
// };

export default positionsCommand