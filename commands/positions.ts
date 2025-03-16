import { BotContext } from "../helper_functions/botContext";
import { Markup, Telegraf } from 'telegraf';
import User, { IPosition } from '../models/schema';
import { updatePositionsPnL, getPortfolioSummary } from '../helper_functions/positionManager';
import { fetchSolanaPriceWithCache } from "../helper_functions/fetchSolprice";
import getUser from "../helper_functions/getUserInfo";
import { getTokenUIAmount } from "../helper_functions/getUserbalance";
import scanToken from "../helper_functions/tokenScanner";
import getTokenDecimals from "../helper_functions/tokenmetaData";
import { getQuote, executeSwap } from "../helper_functions/trade";

// Helper functions for formatting
function formatNumber(num: number, decimals: number = 2): string {
    return num.toFixed(decimals);
}

function formatUSD(amount: number): string {
    return `$${formatNumber(amount)}`;
}

// function calculatePercentageChange(current: number, original: number): number {
//     if (original === 0) return 0; // Avoid division by zero
//     return ((current - original) / Math.abs(original)) * 100;
// }

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

    // Calculate PnL percentages with realized gains
    // For unrealized PnL, calculate based on current holdings only
    const unrealizedPnlPercentage = position.totalTokens > 0 && entryValue > 0
        ? ((currentValue - entryValue) / entryValue) * 100
        : 0;

    // For SOL PnL including realized gains
    const realizedGainsSol = position.realizedGainsSol || 0;
    const totalPnlSol = position.solPnL; // Should include both unrealized and realized
    const solPnlPercentage = position.totalSolSpent > 0
        ? (totalPnlSol / position.totalSolSpent) * 100
        : 0;

    // USD PnL percentage including realized gains
    const realizedGainsUsd = position.realizedGainsUsd || 0;
    const totalPnlUsd = currentUsdValue + realizedGainsUsd - totalUsdSpent;
    const usdPnlPercentage = totalUsdSpent > 0
        ? (totalPnlUsd / totalUsdSpent) * 100
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

    // Format numbers with proper commas and decimals
    function formatNumber(num: number, decimals: number = 2): string {
        return num.toFixed(decimals);
    }

    // Format USD amount
    function formatUSD(amount: number): string {
        return `$${formatNumber(amount)}`;
    }

    // Get emoji for PnL
    function getPnLEmoji(pnl: number): string {
        return pnl >= 0 ? '🟩' : '🟥';
    }

    // Calculate total buys and sells counts
    const buyTrades = position.trades.filter(trade => trade.tokenAmount > 0);
    const sellTrades = position.trades.filter(trade => trade.tokenAmount < 0);

    const totalBuys = buyTrades.length;
    const totalSells = sellTrades.length;

    // Calculate total SOL received from sells
    const totalSolReceived = position.totalSolReceived ||
        sellTrades.reduce((total, trade) => total + Math.abs(trade.solSpent), 0);

    const formattedBalance = formatTokenBalance(position.totalTokens);
    const dexScreenerLink = `https://dexscreener.com/solana/${position.tokenAddress}`;
    const formattedTokenName = `<a href="${dexScreenerLink}">${position.tokenSymbol}</a>`;
    const copyableAddress = `<code>${position.tokenAddress}</code>`;

    // Create the sells section if there are any sells
    const sellsInfo = totalSells > 0
        ? `${formatNumber(totalSolReceived, 4)} SOL (${formatUSD(totalSolReceived * solPrice)}) • (${totalSells} sells)`
        : `N/A • (0 sells)`;

    return `${formattedTokenName} - 📈 - ${formatNumber(position.solPnL, 4)} SOL (${formatUSD(position.usdPnL)})
${copyableAddress}
- Price & MC: ${formatUSD(position.currentPrice)} — ${formatMarketCap(position.currentMarketCap)}
- Entry MC: ${formatMarketCap(position.entryMarketCap)}
- Balance: ${formattedBalance}
- Buys: ${formatNumber(position.totalSolSpent, 4)} SOL (${formatUSD(totalUsdSpent)}) • (${totalBuys} buys)
- Sells: ${sellsInfo}
- PNL USD: ${formatNumber(usdPnlPercentage, 2)}% (${formatUSD(totalPnlUsd)}) ${getPnLEmoji(totalPnlUsd)}
- PNL SOL: ${formatNumber(solPnlPercentage, 2)}% (${formatNumber(totalPnlSol, 4)} SOL) ${getPnLEmoji(totalPnlSol)}
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

// Create a user state map at the top of your positions.ts file
const userSellStates = new Map<number, {
    waitingForSellAmount: boolean;
    tokenCA: string;
    lastInteractionTime: number;
}>();

// Define timeout period (e.g., 5 minutes)
const STATE_TIMEOUT_MS = 5 * 60 * 1000;

// Check if state has timed out
function hasSellStateTimedOut(userId: number): boolean {
    const state = userSellStates.get(userId);
    if (!state) return true;

    const elapsed = Date.now() - state.lastInteractionTime;
    return elapsed > STATE_TIMEOUT_MS;
}

// Update user interaction time
function updateSellInteractionTime(userId: number): void {
    const state = userSellStates.get(userId);
    if (state) {
        state.lastInteractionTime = Date.now();
        userSellStates.set(userId, state);
    }
}

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

    // Handlers for sell operations
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

            await ctx.answerCbQuery(`Preparing to sell ${percent}% of tokens...`);

            const userDetails = await getUser(telegram_id);
            const positions = await updatePositionsPnL(telegram_id, false);

            const tokenPosition = positions.find(p => p.tokenAddress === prefs.selectedToken);
            if (!tokenPosition) {
                await ctx.reply('❌ No position found for this token.');
                return;
            }

            const sellPercentage = percent / 100;
            const tokenAmount = tokenPosition.totalTokens * sellPercentage;

            if (tokenAmount <= 0) {
                await ctx.reply('❌ You have no tokens to sell.');
                return;
            }

            await ctx.reply(`🔄 Processing sell order for ${tokenAmount.toFixed(6)} ${tokenPosition.tokenSymbol} (${percent}%)...`);

            const tokenData = await scanToken(prefs.selectedToken);
            if (!tokenData) {
                await ctx.reply('❌ Error: Unable to fetch token information.');
                return;
            }

            const tokenDecimals = await getTokenDecimals(prefs.selectedToken);
            const tokenBaseUnits = Math.floor(tokenAmount * Math.pow(10, tokenDecimals));

            // Get quote before executing the swap
            const quote = await getQuote(prefs.selectedToken, false, tokenBaseUnits);

            const result = await executeSwap(
                prefs.selectedToken,
                false,
                tokenBaseUnits,
                userDetails.privateKey
            );

            if (result.success && result.signature) {
                const receivedSol = Number(quote.outAmount) / 1e9;

                // Create a trade record for the sell
                const trade = {
                    tokenAddress: prefs.selectedToken,
                    tokenName: tokenData.tokenName,
                    tokenSymbol: tokenData.tokenSymbol,
                    buyPrice: tokenPosition.currentPrice,
                    tokenAmount: -tokenAmount,
                    solSpent: -receivedSol,
                    currentPrice: tokenData.tokenInfo.price,
                    solPnL: 0, // Will be calculated by database
                    usdPnL: 0, // Will be calculated by database
                    entryMarketCap: tokenData.tokenInfo.mktCap,
                    timestamp: new Date()
                };

                // Add the trade to user's record with retry logic
                let retryAttempts = 0;
                let success = false;

                while (!success && retryAttempts < 3) {
                    try {
                        // Get fresh user data on each retry except the first one
                        let currentUserDetails = retryAttempts === 0 ?
                            userDetails :
                            await getUser(telegram_id);

                        await currentUserDetails.addTrade(trade);
                        success = true;
                    } catch (error: unknown) {
                        console.log(`Attempt ${retryAttempts + 1} failed: ${error instanceof Error ? error.message : 'Unknown error'}`);

                        if (error instanceof Error && error.name === 'VersionError') {
                            retryAttempts++;
                            // Wait a bit before retrying
                            await new Promise(resolve => setTimeout(resolve, 500));
                        } else {
                            // Not a version error, rethrow
                            throw error;
                        }
                    }
                }

                if (!success) {
                    console.error('Failed to update database after maximum retries');
                    // Still continue since blockchain transaction succeeded
                }

                const successMessage = `✅ Sell Successful!\n\n` +
                    `💰 Sold: ${tokenAmount.toFixed(6)} ${tokenData.tokenSymbol}\n` +
                    `🪙 Received: ${receivedSol.toFixed(6)} SOL\n` +
                    `📈 Price Impact: ${(Number(quote.priceImpactPct) || 0).toFixed(2)}%\n` +
                    `🔗 Transaction: [View on Solscan](${result.txUrl})`;

                const keyboard = Markup.inlineKeyboard([
                    [Markup.button.callback('View Positions', 'positions')],
                    [Markup.button.callback('Main Menu', 'start')]
                ]);

                await ctx.reply(successMessage, {
                    parse_mode: 'Markdown',
                    link_preview_options: { is_disabled: true },
                    reply_markup: keyboard.reply_markup
                });
            } else {
                await ctx.reply(`❌ Transaction failed: ${result.error}`);
            }

        } catch (error) {
            console.error('Error handling sell operation:', error);
            await ctx.answerCbQuery('❌ Error processing sell request');
            await ctx.reply('❌ Error processing your sell request. Please try again.');
        }
    });


    bot.action('sell_custom', async (ctx) => {
        try {
            const userId = ctx.from?.id;
            if (!userId) {
                throw new Error('Could not identify user');
            }

            const prefs = getUserPreferences(userId.toString());
            if (!prefs.selectedToken) {
                await ctx.answerCbQuery('❌ No token selected');
                return;
            }

            const positions = await updatePositionsPnL(userId.toString(), false);
            const tokenPosition = positions.find(p => p.tokenAddress === prefs.selectedToken);
            if (!tokenPosition) {
                await ctx.reply('❌ No position found for this token.');
                return;
            }

            if (tokenPosition.totalTokens <= 0) {
                await ctx.reply('❌ You have no tokens to sell.');
                return;
            }

            // Store state in the map instead of session
            userSellStates.set(userId, {
                waitingForSellAmount: true,
                tokenCA: prefs.selectedToken,
                lastInteractionTime: Date.now()
            });

            // Create cancel button
            const cancelKeyboard = Markup.inlineKeyboard([
                [Markup.button.callback('❌ Cancel', 'cancel_sell')]
            ]);

            await ctx.answerCbQuery('Custom sell amount');
            await ctx.reply(`📝 Please enter the amount of ${tokenPosition.tokenSymbol} you want to sell (max: ${tokenPosition.totalTokens.toFixed(6)}):`, {
                parse_mode: 'HTML',
                reply_markup: cancelKeyboard.reply_markup
            });

        } catch (error) {
            console.error('Error setting up custom sell:', error);
            await ctx.answerCbQuery('❌ Error setting up custom sell');
        }
    });

    // Add a cancel button handler
    bot.action('cancel_sell', async (ctx) => {
        const userId = ctx.from?.id;
        if (userId) {
            userSellStates.delete(userId);
            await ctx.answerCbQuery('Sell operation cancelled');
            await ctx.reply('❌ Sell operation cancelled.');

            // Return to positions view
            const telegram_id = userId.toString();
            const prefs = getUserPreferences(telegram_id);
            if (ctx.callbackQuery && 'message' in ctx.callbackQuery) {
                await ctx.deleteMessage();
            }
            await displayPositions(ctx, telegram_id, prefs);
        }
    });

    // Handle custom sell amount input
    // Handle custom sell amount input
    bot.on('text', async (ctx, next) => {
        const userId = ctx.from.id;
        const userState = userSellStates.get(userId);

        // Check if state has timed out
        if (hasSellStateTimedOut(userId)) {
            // Clear the state and let other handlers process the message
            userSellStates.delete(userId);
            return next();
        }

        // Only process messages if user is in sell flow and waiting for amount
        if (!userState?.waitingForSellAmount) {
            return next(); // Pass to next handler (like /start)
        }

        console.log(`Processing text in sell flow for user ${userId}`);

        // Update interaction time
        updateSellInteractionTime(userId);

        // Process the sell amount
        const text = ctx.message.text;

        // Try to parse as a number
        const customAmount = parseFloat(text);

        // If not a valid number, show error but stay in sell mode
        if (isNaN(customAmount) || customAmount <= 0) {
            await ctx.reply('❌ Please enter a valid number greater than 0.');
            return;
        }

        try {
            const telegram_id = userId.toString();
            const positions = await updatePositionsPnL(telegram_id, false);
            const tokenPosition = positions.find(p => p.tokenAddress === userState.tokenCA);

            if (!tokenPosition) {
                await ctx.reply('❌ No position found for this token.');
                userSellStates.delete(userId);
                return;
            }

            if (customAmount > tokenPosition.totalTokens) {
                await ctx.reply(`❌ You only have ${tokenPosition.totalTokens.toFixed(6)} ${tokenPosition.tokenSymbol} available.`);
                return;
            }

            await ctx.reply(`🔄 Processing sell order for ${customAmount.toFixed(6)} ${tokenPosition.tokenSymbol}...`);

            const userDetails = await getUser(telegram_id);
            const tokenData = await scanToken(userState.tokenCA);

            if (!tokenData) {
                await ctx.reply('❌ Error: Unable to fetch token information.');
                userSellStates.delete(userId);
                return;
            }

            const tokenDecimals = await getTokenDecimals(userState.tokenCA);
            const tokenBaseUnits = Math.floor(customAmount * Math.pow(10, tokenDecimals));

            // Get quote first
            const quote = await getQuote(userState.tokenCA, false, tokenBaseUnits);

            // Execute the swap
            const result = await executeSwap(
                userState.tokenCA,
                false,
                tokenBaseUnits,
                userDetails.privateKey
            );

            if (result.success && result.signature) {
                const receivedSol = Number(quote.outAmount) / 1e9;

                // Create a trade record for the sell
                const trade = {
                    tokenAddress: userState.tokenCA,
                    tokenName: tokenData.tokenName,
                    tokenSymbol: tokenData.tokenSymbol,
                    buyPrice: tokenPosition.currentPrice,
                    tokenAmount: -customAmount,
                    solSpent: -receivedSol,
                    currentPrice: tokenData.tokenInfo.price,
                    solPnL: 0, // Will be calculated by database
                    usdPnL: 0, // Will be calculated by database
                    entryMarketCap: tokenData.tokenInfo.mktCap,
                    timestamp: new Date()
                };
                // Add the trade to user's record with retry logic
                let retryAttempts = 0;
                let success = false;

                while (!success && retryAttempts < 3) {
                    try {
                        // Get fresh user data on each retry except the first one
                        let currentUserDetails = retryAttempts === 0 ?
                            userDetails :
                            await getUser(telegram_id);

                        await currentUserDetails.addTrade(trade);
                        success = true;
                    } catch (error: unknown) {
                        console.log(`Attempt ${retryAttempts + 1} failed: ${error instanceof Error ? error.message : 'Unknown error'}`);

                        if (error instanceof Error && error.name === 'VersionError') {
                            retryAttempts++;
                            // Wait a bit before retrying
                            await new Promise(resolve => setTimeout(resolve, 500));
                        } else {
                            // Not a version error, rethrow
                            throw error;
                        }
                    }
                }

                if (!success) {
                    console.error('Failed to update database after maximum retries');
                    // Still continue since blockchain transaction succeeded
                }

                const successMessage = `✅ Sell Successful!\n\n` +
                    `💰 Sold: ${customAmount.toFixed(6)} ${tokenData.tokenSymbol}\n` +
                    `🪙 Received: ${receivedSol.toFixed(6)} SOL\n` +
                    `📈 Price Impact: ${(Number(quote.priceImpactPct) || 0).toFixed(2)}%\n` +
                    `🔗 Transaction: [View on Solscan](${result.txUrl})`;

                const keyboard = Markup.inlineKeyboard([
                    [Markup.button.callback('View Positions', 'positions')],
                    [Markup.button.callback('Main Menu', 'start')]
                ]);

                await ctx.reply(successMessage, {
                    parse_mode: 'Markdown',
                    link_preview_options: { is_disabled: true },
                    reply_markup: keyboard.reply_markup
                });

                // Clear the state
                userSellStates.delete(userId);
            } else {
                await ctx.reply(`❌ Transaction failed: ${result.error}`);
                userSellStates.delete(userId);
            }
        } catch (error) {
            console.error('Error processing custom sell amount:', error);
            await ctx.reply('❌ Error processing sell order. Please try again.');
            // Keep the state active to allow retry
        }
    });
};

export default positionsCommand;