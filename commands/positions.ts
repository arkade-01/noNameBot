import { BotContext } from "../helper_functions/botContext";
import { Telegraf } from 'telegraf';
import User, { IPosition } from '../models/schema';
import { updatePositionsPnL, getPortfolioSummary } from '../helper_functions/positionManager';
import { fetchSolanaPriceWithCache } from "../helper_functions/fetchSolprice";
import getUser from "../helper_functions/getUserInfo";
import { getTokenUIAmount } from "../helper_functions/getUserbalance";

// Helper functions for formatting
function formatNumber(num: number, decimals: number = 2): string {
    return num.toFixed(decimals);
}

function formatUSD(amount: number): string {
    return `$${formatNumber(amount)}`;
}

function calculatePercentageChange(current: number, original: number): number {
    if (original === 0) return 0; // Avoid division by zero
    return ((current - original) / Math.abs(original)) * 100;
}

function getPnLEmoji(pnl: number): string {
    return pnl >= 0 ? '🟩' : '🟥';
}

export async function formatPosition(position: IPosition, solPrice: number): Promise<string> {
    // Calculate current value and entry value
    const currentValue = position.totalTokens * position.currentPrice;
    const entryValue = position.totalTokens * position.averageBuyPrice;

    // Get USD values (either stored or calculated)
    const totalUsdSpent = position.totalUsdSpent || position.totalSolSpent * solPrice;
    const currentUsdValue = position.currentUsdValue || currentValue * solPrice;

    // Calculate PnL percentages correctly
    const pnlPercentage = position.totalTokens > 0
        ? calculatePercentageChange(currentValue, entryValue)
        : 0;

    // For SOL PnL, calculate based on actual returns vs investment
    const solPnlPercentage = position.totalSolSpent > 0
        ? (position.solPnL / position.totalSolSpent) * 100
        : 0;

    // USD PnL percentage
    const usdPnlPercentage = totalUsdSpent > 0
        ? ((currentUsdValue - totalUsdSpent) / totalUsdSpent) * 100
        : 0;

    // Format market cap data
    function formatMarketCap(mcap: number): string {
        if (mcap >= 1_000_000) {
            return `${formatNumber(mcap / 1_000_000)}M`;
        } else if (mcap >= 1_000) {
            return `${formatNumber(mcap / 1_000)}K`;
        }
        return formatNumber(mcap);
    }

    // Format token amount with appropriate precision based on its value
    function formatTokenBalance(amount: number): string {
        if (amount >= 1000000) {
            return formatNumber(amount / 1000000, 2) + 'M';
        } else if (amount >= 1000) {
            return formatNumber(amount / 1000, 2) + 'K';
        } else if (amount >= 1) {
            return formatNumber(amount, 2);
        } else if (amount > 0) {
            // For small numbers, use more decimals
            return amount.toFixed(Math.min(6, Math.max(2, 6 - Math.floor(Math.log10(amount)))));
        }
        return '0';
    }

    const formattedBalance = formatTokenBalance(position.totalTokens);
    const dexScreenerLink = `https://dexscreener.com/solana/${position.tokenAddress}`;
    const formattedTokenName = `<a href="${dexScreenerLink}">${position.tokenSymbol}</a>`;
    const copyableAddress = `<code>${position.tokenAddress}</code>`;

    return `${formattedTokenName} - 📈 - ${formatNumber(position.solPnL, 4)} SOL (${formatUSD(position.usdPnL)})
${copyableAddress}
- Price & MC: ${formatUSD(position.currentPrice)} — ${formatMarketCap(position.currentMarketCap)}
- Entry MC: ${formatMarketCap(position.entryMarketCap)}
- Balance: ${formattedBalance}
- Buys: ${formatNumber(position.totalSolSpent, 4)} SOL (${formatUSD(totalUsdSpent)}) • (${position.trades.length} buys)
- Sells: N/A • (0 sells)
- PNL USD: ${formatNumber(usdPnlPercentage, 2)}% (${formatUSD(currentUsdValue - totalUsdSpent)}) ${getPnLEmoji(currentUsdValue - totalUsdSpent)}
- PNL SOL: ${formatNumber(solPnlPercentage, 2)}% (${formatNumber(position.solPnL, 4)} SOL) ${getPnLEmoji(position.solPnL)}
- Current Value: ${formatUSD(currentUsdValue)}`;
}

const userPreferences = new Map<string, UserPreferences>();

interface UserPreferences {
    hideZeroBalances: boolean;
    currentPage: number;
    selectedToken: string | null; // Changed to single token selection
    sortBy?: 'name' | 'value' | 'pnl'; // Added sort options
}

const DEFAULT_PREFERENCES: UserPreferences = {
    hideZeroBalances: false,
    currentPage: 0,
    selectedToken: null,
    sortBy: 'name'
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
    hideZeroBalances: boolean,
    solPrice: number
): any {
    const itemsPerPage = 9;
    const startIdx = preferences.currentPage * itemsPerPage;
    const filteredPositions = hideZeroBalances
        ? positions.filter(pos => pos.totalTokens > 0)
        : positions;

    // Sort positions based on user preference
    let sortedPositions = [...filteredPositions];
    if (preferences.sortBy === 'value') {
        sortedPositions.sort((a, b) => {
            const aValue = (a.currentUsdValue || a.totalTokens * a.currentPrice * solPrice);
            const bValue = (b.currentUsdValue || b.totalTokens * b.currentPrice * solPrice);
            return bValue - aValue; // Descending
        });
    } else if (preferences.sortBy === 'pnl') {
        sortedPositions.sort((a, b) => b.usdPnL - a.usdPnL); // Descending
    } else {
        // Default sort by name
        sortedPositions.sort((a, b) => a.tokenSymbol.localeCompare(b.tokenSymbol));
    }

    if (!preferences.selectedToken && sortedPositions.length > 0) {
        preferences.selectedToken = sortedPositions[0].tokenAddress;
    }

    const tokens = sortedPositions.slice(startIdx, startIdx + itemsPerPage);
    const totalPages = Math.ceil(sortedPositions.length / itemsPerPage);

    // Function to format token balances in a compact way
    function formatCompactBalance(amount: number): string {
        if (amount >= 1000000) {
            return `${(amount / 1000000).toFixed(1)}M`;
        } else if (amount >= 1000) {
            return `${(amount / 1000).toFixed(1)}K`;
        } else if (amount >= 1) {
            return amount.toFixed(1);
        } else if (amount > 0) {
            return amount.toFixed(2);
        }
        return '0';
    }

    const tokenButtons: any[][] = [];
    for (let i = 0; i < tokens.length; i += 3) {
        const rowTokens = tokens.slice(i, i + 3);
        const row = rowTokens.map(pos => {
            // Show token value or PNL based on sort preference
            let displayValue = formatCompactBalance(pos.totalTokens);
            if (preferences.sortBy === 'value') {
                const value = pos.currentUsdValue || pos.totalTokens * pos.currentPrice * solPrice;
                displayValue = `$${value >= 1000 ? (value / 1000).toFixed(1) + 'K' : value.toFixed(0)}`;
            } else if (preferences.sortBy === 'pnl') {
                const pnlSymbol = pos.usdPnL >= 0 ? '+' : '';
                displayValue = `${pnlSymbol}$${Math.abs(pos.usdPnL) >= 1000 ? (pos.usdPnL / 1000).toFixed(1) + 'K' : pos.usdPnL.toFixed(0)}`;
            }

            return {
                text: `${pos.tokenSymbol} ${preferences.selectedToken === pos.tokenAddress ? '✅' : ''} (${displayValue})`,
                callback_data: `select_token:${pos.tokenAddress}`
            };
        });
        tokenButtons.push(row);
    }

    // Add sell buttons for selected token
    const sellButtons = [];
    if (preferences.selectedToken) {
        const selectedPosition = positions.find(p => p.tokenAddress === preferences.selectedToken);
        if (selectedPosition && selectedPosition.totalTokens > 0) {
            // Percentage sell buttons
            const percentageRow = [
                { text: '25%', callback_data: 'sell_25' },
                { text: '50%', callback_data: 'sell_50' },
                { text: '75%', callback_data: 'sell_75' },
                { text: '100%', callback_data: 'sell_100' }
            ];
            sellButtons.push(percentageRow);

            // Custom sell button
            sellButtons.push([
                { text: '💰 Custom Sell Amount', callback_data: 'sell_custom' }
            ]);
        }
    }

    // Navigation controls
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

    // Sort controls
    const sortRow = [
        { text: `${preferences.sortBy === 'name' ? '✅ ' : ''}Sort by Name`, callback_data: 'sort_name' },
        { text: `${preferences.sortBy === 'value' ? '✅ ' : ''}Sort by Value`, callback_data: 'sort_value' },
        { text: `${preferences.sortBy === 'pnl' ? '✅ ' : ''}Sort by PNL`, callback_data: 'sort_pnl' }
    ];

    // Control buttons
    const controlButtons = [
        [
            { text: '🔄 Refresh', callback_data: 'update_prices' },
            { text: hideZeroBalances ? '👁️ Show All' : '🔍 Hide Empty', callback_data: 'toggle_zero' },
            { text: '🗑️ Clear All', callback_data: 'clear_positions' }
        ],
        [{ text: '⬅️ Back to Menu', callback_data: 'start' }]
    ];

    return {
        inline_keyboard: [
            ...tokenButtons,
            ...sellButtons,
            ...(navRow.length > 0 ? [navRow] : []),
            [sortRow[0], sortRow[1]],
            [sortRow[2]],
            ...controlButtons
        ]
    };
}

export const positionsCommand = (bot: Telegraf<BotContext>) => {
    // Display positions function
    async function displayPositions(
        ctx: any,
        telegram_id: string,
        preferences: UserPreferences = DEFAULT_PREFERENCES
    ) {
        try {
            // Add debug logs
            console.log('Fetching positions for user:', telegram_id);
            const positions = await updatePositionsPnL(telegram_id, false);
            console.log('Retrieved positions:', positions);

            const user = await User.findOne({ telegram_id });
            console.log('User trades:', user?.trades);
            console.log('User positions:', user?.positions);

            const summary = await getPortfolioSummary(telegram_id);
            const solPrice = await fetchSolanaPriceWithCache();
            const userData = await getUser(telegram_id);
            const userBalance = userData.userBalance || 0;

            const filteredPositions = preferences.hideZeroBalances
                ? positions.filter(pos => pos.totalTokens > 0)
                : positions;

            console.log('Filtered positions:', filteredPositions);

            // Format header with more comprehensive overview including USD values
            const header = `📊 Portfolio Overview
Tokens: ${filteredPositions.length}/${positions.length}
SOL Balance: ${formatNumber(userBalance, 4)} SOL (${formatUSD(userBalance * solPrice)})
Positions Value: ${formatNumber(summary.totalSolPnL + summary.totalSolSpent, 4)} SOL (${formatUSD(summary.currentUsdValue)})
Total Invested: ${formatNumber(summary.totalSolSpent, 4)} SOL (${formatUSD(summary.totalUsdSpent)})
Total P&L: ${formatNumber(summary.totalSolPnL, 4)} SOL (${formatUSD(summary.totalUsdPnL)}) ${getPnLEmoji(summary.totalUsdPnL)}
P&L %: ${formatNumber((summary.totalSolPnL / (summary.totalSolSpent || 1)) * 100, 2)}%
SOL Price: ${formatUSD(solPrice)}
Last Update: ${new Date().toLocaleTimeString()}`;

            // Generate position details
            const positionPromises = filteredPositions.map(pos => formatPosition(pos, solPrice));
            const positionStrings = await Promise.all(positionPromises);

            const keyboard = generatePositionsKeyboard(
                positions,
                preferences,
                preferences.hideZeroBalances,
                solPrice
            );

            const message = [
                header,
                ...positionStrings,
                '\n💡 Click on a token button below to view detailed information and actions.'
            ].join('\n\n');

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

    // Handle positions action
    bot.action('positions', async (ctx) => {
        try {
            const telegram_id = ctx.from?.id.toString();
            if (!telegram_id) {
                await ctx.reply('Error: Could not identify user');
                return;
            }

            const prefs = getUserPreferences(telegram_id);
            await displayPositions(ctx, telegram_id, prefs);

        } catch (error) {
            console.error('Error in positions action:', error);
            await ctx.reply('❌ Error fetching positions. Please try again later.');
        }
    });

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

    // Toggle zero balances
    bot.action('toggle_zero', async (ctx) => {
        try {
            const telegram_id = ctx.from?.id.toString();
            if (!telegram_id) throw new Error('User not identified');

            const prefs = getUserPreferences(telegram_id);
            prefs.hideZeroBalances = !prefs.hideZeroBalances;
            prefs.currentPage = 0; // Reset to first page
            userPreferences.set(telegram_id, prefs);

            await ctx.answerCbQuery(prefs.hideZeroBalances ? 'Hiding empty positions' : 'Showing all positions');
            if (ctx.callbackQuery && 'message' in ctx.callbackQuery) {
                await ctx.deleteMessage();
            }
            await displayPositions(ctx, telegram_id, prefs);
        } catch (error) {
            console.error('Error toggling zero balances:', error);
            await ctx.answerCbQuery('❌ Error updating display preferences');
        }
    });

    // Handle sorting options
    bot.action(/^sort_(name|value|pnl)$/, async (ctx) => {
        try {
            const sortBy = ctx.match[1] as 'name' | 'value' | 'pnl';
            const telegram_id = ctx.from?.id.toString();
            if (!telegram_id) throw new Error('User not identified');

            const prefs = getUserPreferences(telegram_id);
            prefs.sortBy = sortBy;
            prefs.currentPage = 0; // Reset to first page
            userPreferences.set(telegram_id, prefs);

            await ctx.answerCbQuery(`Sorting by ${sortBy}`);
            if (ctx.callbackQuery && 'message' in ctx.callbackQuery) {
                await ctx.deleteMessage();
            }
            await displayPositions(ctx, telegram_id, prefs);
        } catch (error) {
            console.error('Error setting sort order:', error);
            await ctx.answerCbQuery('❌ Error updating sort preferences');
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

    // Clear positions handler
    bot.action('clear_positions', async (ctx) => {
        try {
            const telegram_id = ctx.from?.id.toString();
            if (!telegram_id) {
                throw new Error('Could not identify user');
            }

            // Find the user and clear both positions and trades
            const user = await User.findOne({ telegram_id });
            if (user) {
                user.positions = [];  // Clear positions array
                user.trades = [];     // Clear trades array
                await user.save();
                await ctx.answerCbQuery('🗑️ All positions and trades cleared');
            } else {
                await ctx.answerCbQuery('❌ User not found');
                return;
            }

            if (ctx.callbackQuery && 'message' in ctx.callbackQuery) {
                await ctx.deleteMessage();
            }

            const prefs = getUserPreferences(telegram_id);
            await displayPositions(ctx, telegram_id, prefs);
        } catch (error) {
            console.error('Error clearing positions and trades:', error);
            await ctx.answerCbQuery('❌ Error clearing data. Please try again.');
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
            await updatePositionsPnL(telegram_id, true);
            await displayPositions(ctx, telegram_id, prefs);
        } catch (error) {
            console.error('Error updating prices:', error);
            await ctx.answerCbQuery('❌ Error updating prices. Please try again.');
        }
    });

    // Select token handler
    bot.action(/^select_token:(.+)$/, async (ctx) => {
        try {
            const tokenAddress = ctx.match[1];
            const telegram_id = ctx.from?.id.toString();
            if (!telegram_id) {
                throw new Error('Could not identify user');
            }

            const prefs = getUserPreferences(telegram_id);
            prefs.selectedToken = tokenAddress;
            ctx.session.tokenCA = tokenAddress; // Set token CA in session
            userPreferences.set(telegram_id, prefs);

            if (ctx.callbackQuery && 'message' in ctx.callbackQuery) {
                await ctx.deleteMessage();
            }

            await displayPositions(ctx, telegram_id, prefs);
        } catch (error) {
            console.error('Error selecting token:', error);
        }
    });

    // Handlers for sell operations would go here
    bot.action(/^sell_(25|50|75|100)$/, async (ctx) => {
        try {
            const percentStr = ctx.match[1];
            const percent = parseInt(percentStr);
            const telegram_id = ctx.from?.id.toString();

            if (!telegram_id) {
                throw new Error('Could not identify user');
            }

            const prefs = getUserPreferences(telegram_id);
            if (!prefs.selectedToken) {
                await ctx.answerCbQuery('❌ No token selected');
                return;
            }

            // Here you would implement the sell logic using percent and prefs.selectedToken
            await ctx.answerCbQuery(`Preparing to sell ${percent}% of tokens...`);

            // For now, just tell the user this feature is coming soon
            await ctx.reply(`📣 Sell feature will be implemented soon! You selected to sell ${percent}% of your ${prefs.selectedToken.substring(0, 6)}... tokens.`, {
                parse_mode: 'HTML'
            });

        } catch (error) {
            console.error('Error handling sell operation:', error);
            await ctx.answerCbQuery('❌ Error processing sell request');
        }
    });

    bot.action('sell_custom', async (ctx) => {
        try {
            const telegram_id = ctx.from?.id.toString();
            if (!telegram_id) {
                throw new Error('Could not identify user');
            }

            const prefs = getUserPreferences(telegram_id);
            if (!prefs.selectedToken) {
                await ctx.answerCbQuery('❌ No token selected');
                return;
            }

            await ctx.answerCbQuery('Custom sell amount');
            await ctx.reply('📝 Please enter the amount of tokens you want to sell:', {
                parse_mode: 'HTML'
            });

            // Here you would set up a scene or middleware to handle the user's response

        } catch (error) {
            console.error('Error setting up custom sell:', error);
            await ctx.answerCbQuery('❌ Error setting up custom sell');
        }
    });
};

export default positionsCommand;