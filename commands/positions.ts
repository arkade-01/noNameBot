import { BotContext } from "../helper_functions/botContext";
import { Telegraf } from 'telegraf';
import User, { IPosition } from '../models/schema';
import { updatePositionsPnL, getPortfolioSummary } from '../helper_functions/positionManager';
import { fetchSolanaPriceWithCache } from "../helper_functions/fetchSolprice";
import getUser from "../helper_functions/getUserInfo";
import getTokenDecimals from '../helper_functions/tokenmetaData';

// Enhanced helper functions with decimal handling
async function formatTokenAmount(amount: number, tokenAddress: string): Promise<string> {
    try {
        const decimals = await getTokenDecimals(tokenAddress);
        return amount.toFixed(decimals);
    } catch (error) {
        console.error('Error getting token decimals:', error);
        return amount.toFixed(6); // Fallback to 6 decimals
    }
}

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

export async function formatPosition(position: IPosition, solPrice: number): Promise<string> {
    const tokenDecimals = await getTokenDecimals(position.tokenAddress);
    
    // Calculate current value and entry value
    const currentValue = position.totalTokens * position.currentPrice;
    const entryValue = position.totalTokens * position.averageBuyPrice;

    // Calculate PnL percentages correctly
    const pnlPercentage = position.totalTokens > 0 
        ? calculatePercentageChange(currentValue, entryValue)
        : 0;

    // For SOL PnL, calculate based on actual returns vs investment
    const solPnlPercentage = position.totalSolSpent > 0
        ? (position.solPnL / position.totalSolSpent) * 100
        : 0;

    // Rest of the formatting code remains the same
    function formatMarketCap(mcap: number): string {
        if (mcap >= 1_000_000) {
            return `${formatNumber(mcap / 1_000_000)}M`;
        } else if (mcap >= 1_000) {
            return `${formatNumber(mcap / 1_000)}K`;
        }
        return formatNumber(mcap);
    }

    const formattedBalance = await formatTokenAmount(position.totalTokens, position.tokenAddress);
    const dexScreenerLink = `https://dexscreener.com/solana/${position.tokenAddress}`;
    const formattedTokenName = `<a href="${dexScreenerLink}">${position.tokenSymbol}</a>`;
    const copyableAddress = `<code>${position.tokenAddress}</code>`;

    return `${formattedTokenName} - 📈 - ${formatNumber(position.solPnL)} SOL (${formatUSD(position.usdPnL)})
${copyableAddress}
- Price & MC: ${formatUSD(position.currentPrice)} — ${formatMarketCap(position.currentMarketCap)}
- Entry MC: ${formatMarketCap(position.entryMarketCap)}
- Balance: ${formattedBalance}
- Buys: ${formatNumber(position.totalSolSpent, 4)} SOL (${formatUSD(position.totalSolSpent * solPrice)}) • (${position.trades.length} buys)
- Sells: N/A • (0 sells)
- PNL USD: ${formatNumber(pnlPercentage, 2)}% (${formatUSD(position.usdPnL)}) ${getPnLEmoji(position.usdPnL)}
- PNL SOL: ${formatNumber(solPnlPercentage, 2)}% (${formatNumber(position.solPnL, 4)} SOL) ${getPnLEmoji(position.solPnL)}`;
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

    if (!preferences.selectedToken && sortedPositions.length > 0) {
        preferences.selectedToken = sortedPositions[0].tokenAddress;
    }

    const tokens = sortedPositions.slice(startIdx, startIdx + itemsPerPage);
    const totalPages = Math.ceil(sortedPositions.length / itemsPerPage);

    const tokenButtons: any[][] = [];
    for (let i = 0; i < tokens.length; i += 3) {
        const rowTokens = tokens.slice(i, i + 3);
        const row = rowTokens.map(pos => ({
            text: `${pos.tokenSymbol} ${preferences.selectedToken === pos.tokenAddress ? '✅' : ''} (${pos.totalTokens.toFixed(2)})`,
            callback_data: `select_token:${pos.tokenAddress}`
        }));
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
            { text: '🗑️ Clear All', callback_data: 'clear_positions' } 
                ],
        [{ text: '⬅️ Back to Menu', callback_data: 'start' }]
    ];

    return {
        inline_keyboard: [
            ...tokenButtons,
            ...sellButtons,
            ...(navRow.length > 0 ? [navRow] : []),
            ...controlButtons
        ]
    };
}


export const positionsCommand = (bot: Telegraf<BotContext>) => {
// In displayPositions function
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

        const sortedPositions = [...filteredPositions].sort((a, b) =>
            a.tokenSymbol.localeCompare(b.tokenSymbol)
        );

        // Format header with more precise SOL values
        const header = `📊 Portfolio Overview
Tokens: ${filteredPositions.length}/${positions.length}
Balance: ${formatNumber(userBalance, 4)} SOL (${formatUSD(userBalance * solPrice)})
Positions: ${formatNumber(summary.totalSolPnL + summary.totalSolSpent, 4)} SOL (${formatUSD((summary.totalSolPnL + summary.totalSolSpent) * solPrice)})
Last Update: ${new Date().toLocaleTimeString()}`;

        // Generate position details with proper decimal formatting
        const positionPromises = sortedPositions.map(pos => formatPosition(pos, solPrice));
        const positionStrings = await Promise.all(positionPromises);

        const keyboard = generatePositionsKeyboard(
            positions,
            preferences,
            preferences.hideZeroBalances
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
};

export default positionsCommand;