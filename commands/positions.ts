import { BotContext } from "../helper_functions/botContext";
import { Telegraf } from 'telegraf';
import { IPosition } from '../models/schema';
import { updatePositionsPnL, getPortfolioSummary } from '../helper_functions/positionManager';
import { fetchSolanaPriceWithCache } from "../helper_functions/fetchSolprice";
import getUser from "../helper_functions/getUserInfo";

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

export function formatPosition(position: IPosition, solPrice: number): string {
    // Calculate current market cap in USD using total tokens and current price
    const currentMarketCap = position.currentMarketCap;
    const entryMarketCap = position.entryMarketCap;

    // Calculate PnL percentages
    const pnlPercentage = calculatePercentageChange(
        position.currentPrice,
        position.averageBuyPrice
    );

    const solPnlPercentage = calculatePercentageChange(
        position.solPnL + position.totalSolSpent,
        position.totalSolSpent
    );

    // Format market caps to be more readable (e.g., 1.2M, 450K, etc.)
    function formatMarketCap(mcap: number): string {
        if (mcap >= 1_000_000) {
            return `${formatNumber(mcap / 1_000_000)}M`;
        } else if (mcap >= 1_000) {
            return `${formatNumber(mcap / 1_000)}K`;
        }
        return formatNumber(mcap);
    }

    // Create clickable DexScreener link and copyable address
    const dexScreenerLink = `https://dexscreener.com/solana/${position.tokenAddress}`;
    const formattedTokenName = `<a href="${dexScreenerLink}">${position.tokenSymbol}</a>`;
    const copyableAddress = `<code>${position.tokenAddress}</code>`;

    return `${formattedTokenName} - 📈 - ${formatNumber(position.solPnL)} SOL (${formatUSD(position.usdPnL)})
${copyableAddress}
- Price & MC: ${formatUSD(position.currentPrice)} — ${formatMarketCap(currentMarketCap)}
- Entry MC: ${formatMarketCap(entryMarketCap)}
- Balance: ${formatNumber(position.totalTokens, 2)}
- Buys: ${formatNumber(position.totalSolSpent)} SOL (${formatUSD(position.totalSolSpent * solPrice)}) • (${position.trades.length} buys)
- Sells: N/A • (0 sells)
- PNL USD: ${formatNumber(pnlPercentage)}% (${formatUSD(position.usdPnL)}) ${getPnLEmoji(position.usdPnL)}
- PNL SOL: ${formatNumber(solPnlPercentage)}% (${formatNumber(position.solPnL)} SOL) ${getPnLEmoji(position.solPnL)}`;
}

const userPreferences = new Map<string, UserPreferences>();

interface UserPreferences {
    hideZeroBalances: boolean;
    currentPage: number;
    selectedToken: string | null; // Changed to single token selection
}

const DEFAULT_PREFERENCES: UserPreferences = {
    hideZeroBalances: false,
    currentPage: 0,
    selectedToken: null
};

// Function to get or create user preferences
function getUserPreferences(telegram_id: string): UserPreferences {
    if (!userPreferences.has(telegram_id)) {
        const prefs = { ...DEFAULT_PREFERENCES };
        userPreferences.set(telegram_id, prefs);
    }
    return userPreferences.get(telegram_id) || DEFAULT_PREFERENCES;
}


// Function to generate keyboard with integrated token menu

function generatePositionsKeyboard(
    positions: IPosition[],
    preferences: UserPreferences,
    hideZeroBalances: boolean
): any {
    const itemsPerPage = 9;
    const startIdx = preferences.currentPage * itemsPerPage;
    const filteredPositions = hideZeroBalances
        ? positions.filter(pos => pos.totalTokens > 0)
        : positions;

    const sortedPositions = [...filteredPositions].sort((a, b) =>
        a.tokenSymbol.localeCompare(b.tokenSymbol)
    );

    // Automatically select first token if none selected
    if (!preferences.selectedToken && sortedPositions.length > 0) {
        preferences.selectedToken = sortedPositions[0].tokenAddress;
    }

    const tokens = sortedPositions.slice(startIdx, startIdx + itemsPerPage);
    const totalPages = Math.ceil(sortedPositions.length / itemsPerPage);

    // Generate token buttons with checkmark only for selected token
    const tokenButtons: any[][] = [];
    for (let i = 0; i < tokens.length; i += 3) {
        const rowTokens = tokens.slice(i, i + 3);
        const row = rowTokens.map(pos => ({
            text: `${pos.tokenSymbol} ${preferences.selectedToken === pos.tokenAddress ? '✅' : ''} (${pos.totalTokens.toFixed(2)})`,
            callback_data: `select_token:${pos.tokenAddress}`
        }));
        tokenButtons.push(row);
    }

    const navRow = [];
    if (totalPages > 1) {
        if (preferences.currentPage > 0) {
            navRow.push({
                text: '⬅️ Previous',
                callback_data: `pos_page:${preferences.currentPage - 1}`
            });
        }
        navRow.push({
            text: `📄 ${preferences.currentPage + 1}/${totalPages}`,
            callback_data: 'noop'
        });
        if (preferences.currentPage < totalPages - 1) {
            navRow.push({
                text: '➡️ Next',
                callback_data: `pos_page:${preferences.currentPage + 1}`
            });
        }
    }

    const controlButtons = [
        [
            { text: '🔄 Refresh', callback_data: 'update_prices' },
            { text: `👁 ${hideZeroBalances ? 'Show All' : 'Hide Zero'}`, callback_data: 'toggle_zero_balances' }
        ],
        [{ text: '⬅️ Back to Menu', callback_data: 'start' }]
    ];

    return {
        inline_keyboard: [
            ...tokenButtons,
            ...(navRow.length > 0 ? [navRow] : []),
            ...controlButtons
        ]
    };
}
export const positionsCommand = (bot: Telegraf<BotContext>) => {
    async function displayPositions(
        ctx: any,
        telegram_id: string,
        preferences: UserPreferences = DEFAULT_PREFERENCES
    ) {
        try {
            // Fetch all necessary data
            const positions = await updatePositionsPnL(telegram_id);
            const summary = await getPortfolioSummary(telegram_id);
            const solPrice = await fetchSolanaPriceWithCache();
            const userData = await getUser(telegram_id);
            const balance = userData.userBalance;

            // Filter positions based on preferences
            const filteredPositions = preferences.hideZeroBalances
                ? positions.filter(pos => pos.totalTokens > 0)
                : positions;

            // Sort positions by symbol
            const sortedPositions = [...filteredPositions].sort((a, b) =>
                a.tokenSymbol.localeCompare(b.tokenSymbol)
            );

            // Create header with portfolio overview
            const header = `📊 Portfolio Overview
Tokens: ${filteredPositions.length}/${positions.length}
Balance: ${formatNumber(balance)} SOL (${formatUSD(balance * solPrice)})
Positions: ${formatNumber(summary.totalSolPnL + summary.totalSolSpent)} SOL (${formatUSD((summary.totalSolPnL + summary.totalSolSpent) * solPrice)})
Last Update: ${new Date().toLocaleTimeString()}`;

            // Generate position details for each token
            const positionStrings = sortedPositions.map(pos => {
                const formattedPos = formatPosition(pos, solPrice);
                return formattedPos;
            });

            // Generate the keyboard interface
            const keyboard = generatePositionsKeyboard(
                positions,
                preferences,
                preferences.hideZeroBalances
            );

            // Combine all parts of the message
            const message = [
                header,
                ...positionStrings,
                '\n💡 Click on a token button below to view detailed information and actions.'
            ].join('\n\n');

            // Send the complete message with keyboard
            return await ctx.reply(message, {
                parse_mode: 'HTML',
                disable_web_page_preview: true,
                reply_markup: keyboard
            });

        } catch (error) {
            console.error('Error in displayPositions:', error);
            throw new Error('Failed to display positions');
        }
    }

    // Handle /positions command
    bot.command('positions', async (ctx) => {
        try {
            const telegram_id = ctx.from?.id.toString();
            if (!telegram_id) {
                await ctx.reply('Error: Could not identify user');
                return;
            }

            const prefs = getUserPreferences(telegram_id);
            await displayPositions(ctx, telegram_id, prefs);

        } catch (error) {
            console.error('Error in positions command:', error);
            await ctx.reply('❌ Error fetching positions. Please try again later.');
        }
    });

    // Handle page navigation
    bot.action(/^pos_page:(\d+)$/, async (ctx) => {
        try {
            const page = parseInt(ctx.match[1]);
            const telegram_id = ctx.from?.id.toString();
            if (!telegram_id) throw new Error('User not identified');

            const prefs = getUserPreferences(telegram_id);
            prefs.currentPage = page;
            userPreferences.set(telegram_id, prefs);

            await ctx.answerCbQuery(`Loading page ${page + 1}...`);
            if (ctx.callbackQuery && 'message' in ctx.callbackQuery) {
                await ctx.deleteMessage();
            }
            await displayPositions(ctx, telegram_id, prefs);
        } catch (error) {
            console.error('Error in page navigation:', error);
            await ctx.answerCbQuery('❌ Error navigating pages');
        }
    });

    // Toggle zero balances handler
    bot.action('toggle_zero_balances', async (ctx) => {
        try {
            const telegram_id = ctx.from?.id.toString();
            if (!telegram_id) {
                throw new Error('Could not identify user');
            }

            const prefs = getUserPreferences(telegram_id);
            prefs.hideZeroBalances = !prefs.hideZeroBalances;
            userPreferences.set(telegram_id, prefs);

            const statusText = prefs.hideZeroBalances ?
                'Hiding zero balances' :
                'Showing all balances';
            await ctx.answerCbQuery(`👁 ${statusText}`);

            if (ctx.callbackQuery && 'message' in ctx.callbackQuery) {
                await ctx.deleteMessage();
            }

            await displayPositions(ctx, telegram_id, prefs);
        } catch (error) {
            console.error('Error toggling zero balances:', error);
            await ctx.answerCbQuery('❌ Error updating display preferences. Please try again.');
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

            const prefs = getUserPreferences(telegram_id);
            await displayPositions(ctx, telegram_id, prefs);
        } catch (error) {
            console.error('Error updating prices:', error);
            await ctx.answerCbQuery('❌ Error updating prices. Please try again.');
        }
    });

    bot.action(/^select_token:(.+)$/, async (ctx) => {
        try {
            const tokenAddress = ctx.match[1];
            const telegram_id = ctx.from?.id.toString();
            if (!telegram_id) {
                throw new Error('Could not identify user');
            }

            const prefs = getUserPreferences(telegram_id);
            prefs.selectedToken = tokenAddress;
            userPreferences.set(telegram_id, prefs);

            if (ctx.callbackQuery && 'message' in ctx.callbackQuery) {
                await ctx.deleteMessage();
            }

            await displayPositions(ctx, telegram_id, prefs);
        } catch (error) {
            console.error('Error selecting token:', error);
        }
    });
};

export default positionsCommand;