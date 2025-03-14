import { Context, Markup, Telegraf } from "telegraf";
import dotenv from "dotenv";
import { getQuote } from "../helper_functions/trade";
import scanToken from "../helper_functions/tokenScanner";
import { BotContext } from "../helper_functions/botContext";
import getUser from "../helper_functions/getUserInfo";
import getTokenDecimals from "../helper_functions/tokenmetaData";
import { getTopTraders } from "../helper_functions/topTraders";
import { WalletTrackerService, TokenInfo } from "../helper_functions/trackWallet"; // Import from your new file

dotenv.config();

interface SimplifiedTrader {
  owner: string;
  volumeBuy: number;
  volumeSell: number;
}

// Enhanced user state to track which feature the user is interacting with
interface UserState {
  waitingForTokenAddress?: boolean;
  waitingForWalletAddress?: boolean;
  inCopyTradingFlow?: boolean; // Flag to indicate user is in copy trading flow
  lastInteractionTime?: number; // Track when user last interacted with copy trading
}

// Map to store user states
const userStates = new Map<number, UserState>();

// Timeout for user state (30 minutes)
const USER_STATE_TIMEOUT_MS = 30 * 60 * 1000;

// Create a global instance of the tracker service
let trackerService: WalletTrackerService;
let trackerInitialized = false;

// Helper function to escape Markdown characters
const escapeMarkdown = (text: any): string => {
  if (text == null) return '';
  const stringText = String(text);
  return stringText.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
};

// Format token data for response
const formatTokenResponse = async (data: any, quote: any, telegram_id: string, amount: number = 1) => {
  const name = escapeMarkdown(data?.tokenName || '');
  const symbol = escapeMarkdown(data?.tokenSymbol || '');
  const address = escapeMarkdown(data?.address || '');
  const marketCap = escapeMarkdown((data?.tokenInfo?.mktCap || 0).toLocaleString());
  const price = escapeMarkdown(data?.tokenInfo?.price?.toString() || '0');
  const supply = escapeMarkdown((data?.tokenInfo?.supplyAmount || 0).toLocaleString());
  const score = escapeMarkdown((data?.score || 0).toString());
  const userDetails = await getUser(telegram_id);

  let baseResponse = `🔍 Token Analysis\n\n` +
    `📝 Name: ${name} \\(${symbol}\\)\n` +
    `🏦 Contract: ${address}\n` +
    `💰 Market Cap: $${marketCap}\n` +
    `💎 Price: $${price}\n` +
    `📊 Supply: ${supply}\n` +
    `⭐ Score: ${score}/100\n\n` +
    `🛡️ Security Checks:\n` +
    `✅ Mint Function: ${data.auditRisk.mintDisabled ? 'Disabled' : 'Enabled'}\n` +
    `✅ Freeze Function: ${data.auditRisk.freezeDisabled ? 'Disabled' : 'Enabled'}\n` +
    `✅ LP Status: ${data.auditRisk.lpBurned ? 'Burned' : 'Not Burned'}`;

  if (quote && !quote.error) {
    const decimals = await getTokenDecimals(data.address);
    const tokensReceived = escapeMarkdown((Number(quote.outAmount) / Math.pow(10, decimals)).toString());
    const slippage = escapeMarkdown((quote.slippageBps / 100).toString());
    const impact = escapeMarkdown((Number(quote.priceImpactPct) || 0).toFixed(2));
    const balance = escapeMarkdown(userDetails.userBalance.toFixed(4));
    const solAmount = escapeMarkdown(amount.toString());

    baseResponse += `\n\n💱 Quote Info:\n\n` +
      `💰 Balance: ${balance} SOL\n` +
      `${solAmount} SOL ➜ ${tokensReceived} ${symbol}\n` +
      `⚠️ Slippage: ${slippage}%\n` +
      `📊 Price Impact: ${impact}%`;
  }

  return baseResponse;
};

// Format token purchase for Telegram message
const formatTokenPurchase = (token: TokenInfo): string => {
  const formattedAmount = (token.amount / Math.pow(10, token.decimals)).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6
  });

  let message = "🚨 *New Token Purchase Detected* 🚨\n\n";
  message += `*Token:* ${token.symbol} (${token.name})\n`;
  message += `*Amount:* ${formattedAmount}\n`;
  message += `*Token Address:* \`${token.address}\`\n`;
  message += `*Time:* ${new Date(token.purchaseTime).toLocaleString()}\n`;
  message += `*Transaction:* \`${token.txHash.substring(0, 20)}...\`\n\n`;
  message += "You can now manually copy this trade if you wish!";

  return message;
};

// Get the main copy trading menu
const getCopyTradingMenu = () => {
  return {
    inline_keyboard: [
      [{ text: "🔍 Find Top Traders to Copy", callback_data: "find_top_traders" }],
      [{ text: "📋 Enter Wallet Address to Copy", callback_data: "enter_wallet_address" }],
      [{ text: "📊 View Tracked Wallets", callback_data: "view_tracked_wallets" }],
      [{ text: "« Back to Main Menu", callback_data: "return_to_main" }]
    ]
  };
};

const getBackButton = () => {
  return {
    inline_keyboard: [
      [{ text: "« Back to Copy Trading Menu", callback_data: "show_copy_menu" }]
    ]
  };
};

// Format trader data for Telegram message
const formatTradersMessage = (traders: SimplifiedTrader[]): string => {
  let message = "🏆 *Top 3 Traders* 🏆\n\n";

  traders.forEach((trader, index) => {
    message += `*${index + 1}. Wallet:* \`${trader.owner}\`\n`;
    message += `   💰 *Buy Volume:* ${trader.volumeBuy.toFixed(2)}\n`;
    message += `   💸 *Sell Volume:* ${trader.volumeSell.toFixed(2)}\n\n`;
  });

  return message;
};

// Function to check if user state has timed out
const hasUserStateTimedOut = (userId: number): boolean => {
  const userState = userStates.get(userId);
  if (!userState || !userState.lastInteractionTime) return true;

  const now = Date.now();
  return (now - userState.lastInteractionTime) > USER_STATE_TIMEOUT_MS;
};

// Update user state with new interaction time
const updateUserInteractionTime = (userId: number): void => {
  const userState = userStates.get(userId) || {};
  userStates.set(userId, {
    ...userState,
    lastInteractionTime: Date.now()
  });
};

// Start tracking a wallet and set up Telegram notifications
const startWalletTracking = async (bot: Telegraf<BotContext>, chatId: number, walletAddress: string) => {
  if (!trackerInitialized) {
    await bot.telegram.sendMessage(chatId, "Copy trading service is initializing. Please try again in a moment.");
    return;
  }

  const telegramId = chatId.toString();

  // Check if already tracking this wallet
  if (trackerService.isTracking(walletAddress)) {
    await bot.telegram.sendMessage(chatId, `Already tracking wallet: ${walletAddress}`);
    return;
  }

  try {
    // Start tracking for this user
    await trackerService.startTrackingForUser(telegramId, walletAddress);

    await bot.telegram.sendMessage(
      chatId,
      `✅ Started tracking wallet: ${walletAddress}\n\nYou'll receive notifications when this wallet purchases new tokens!`,
      {
        reply_markup: getCopyTradingMenu()
      }
    );

  } catch (error) {
    console.error(`Error starting tracking for wallet ${walletAddress}:`, error);
    await bot.telegram.sendMessage(
      chatId,
      `❌ Error starting to track wallet: ${walletAddress}. Please try again later.`
    );
  }
};

// Stop tracking a wallet
const stopWalletTracking = async (bot: Telegraf<BotContext>, chatId: number, walletAddress: string) => {
  if (!trackerInitialized) {
    await bot.telegram.sendMessage(chatId, "Copy trading service is initializing. Please try again in a moment.");
    return;
  }

  if (!trackerService.isTracking(walletAddress)) {
    await bot.telegram.sendMessage(chatId, `Not currently tracking wallet: ${walletAddress}`, {
      reply_markup: getCopyTradingMenu()
    });
    return;
  }

  // Stop tracking this wallet
  trackerService.stopTracking(walletAddress);

  await bot.telegram.sendMessage(chatId, `Stopped tracking wallet: ${walletAddress}`, {
    reply_markup: getCopyTradingMenu()
  });
};

// List all currently tracked wallets
const listTrackedWallets = async (bot: Telegraf<BotContext>, chatId: number) => {
  if (!trackerInitialized) {
    await bot.telegram.sendMessage(chatId, "Copy trading service is initializing. Please try again in a moment.");
    return;
  }

  const telegramId = chatId.toString();
  const activeTrackers = trackerService.getWalletsTrackedByUser(telegramId);

  if (activeTrackers.length === 0) {
    await bot.telegram.sendMessage(chatId, "You're not tracking any wallets yet.", {
      reply_markup: getCopyTradingMenu()
    });
    return;
  }

  let message = "🔍 *Currently Tracked Wallets* 🔍\n\n";

  let index = 1;
  const inlineKeyboard = [];

  for (const walletAddress of activeTrackers) {
    message += `*${index}. Wallet:* \`${walletAddress}\`\n`;

    // Add a button to stop tracking each wallet
    inlineKeyboard.push([{
      text: `Stop Tracking Wallet ${index} (${walletAddress.slice(0, 6)}...)`,
      callback_data: `stop_tracking_${walletAddress}`
    }]);

    index++;
  }

  // Add the main menu button at the bottom
  inlineKeyboard.push([{
    text: "Return to Copy Trading Menu",
    callback_data: "show_copy_menu"
  }]);

  await bot.telegram.sendMessage(chatId, message, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: inlineKeyboard
    }
  });
};

// Initialize the wallet tracker service
const initializeTrackerService = async (): Promise<boolean> => {
  const BIRDEYE_KEY = process.env.BIRDEYE_KEY as string;
  const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/wallet-tracker';
  const DEBUG_MODE = process.env.DEBUG_MODE === 'true';

  trackerService = new WalletTrackerService(BIRDEYE_KEY, DEBUG_MODE);

  try {
    await trackerService.initialize();
    trackerInitialized = true;
    console.log('Wallet tracker service initialized successfully');
    return true;
  } catch (error) {
    console.error('Failed to initialize wallet tracker service:', error);
    return false;
  }
};

// Setup token purchase event handlers for all users
// Setup token purchase event handlers for all users
const setupTokenPurchaseHandlers = (bot: Telegraf<BotContext>) => {
  trackerService.on('token:purchased', async (tokenInfo: any) => {
    try {
      // Extract the telegram ID from the event data
      const chatId = parseInt(tokenInfo.telegramId || '0');

      if (!chatId) {
        console.error('Missing chat ID for token purchase notification');
        return;
      }

      const message = formatTokenPurchase(tokenInfo);
      await bot.telegram.sendMessage(chatId, message, { parse_mode: 'Markdown' });

      // Offer one-click buy option
      await bot.telegram.sendMessage(chatId, "Would you like to copy this trade?", {
        reply_markup: {
          inline_keyboard: [
            [{ text: "Buy", callback_data: `copy_trade_buy_${tokenInfo.address}` }]
          ]
        }
      });
    } catch (error) {
      console.error('Error sending token purchase notification:', error);
    }
  });
};

// Main copy trading module
const copyTrading = (bot: Telegraf<BotContext>) => {
  // Initialize the tracker service when the bot starts
  initializeTrackerService().then(success => {
    if (success) {
      setupTokenPurchaseHandlers(bot);
    } else {
      console.error('WARNING: Copy trading feature may not work properly due to initialization failure');
    }
  });

  // Entry point to the copy trading feature
  bot.action('copy', async (ctx) => {
    try {
      // Always acknowledge the callback query first
      await ctx.answerCbQuery();

      // Set user in copy trading flow
      const userId = ctx.from?.id;
      if (userId) {
        userStates.set(userId, {
          inCopyTradingFlow: true,
          lastInteractionTime: Date.now()
        });
      }

      // Prepare message
      const message = 'Welcome to the Copy Trading feature! ' +
        'Here you can follow top traders and replicate their strategies automatically.\n\n' +
        'Choose an option to get started:';

      // If we have a callback message, edit it
      if (ctx.callbackQuery && 'message' in ctx.callbackQuery) {
        await ctx.editMessageText(message, {
          reply_markup: getCopyTradingMenu()
        });
      } else {
        // Otherwise send a new message
        await ctx.reply(message, {
          reply_markup: getCopyTradingMenu()
        });
      }

      console.log('Copy trading menu displayed successfully');
    } catch (error) {
      console.error('Error in copy action handler:', error);
      await ctx.reply('An error occurred while loading the copy trading menu.');
    }
  });

  // Return to copy trading menu
  bot.action('show_copy_menu', async (ctx) => {
    await ctx.answerCbQuery();

    // Update user state
    const userId = ctx.from?.id;
    if (userId) {
      userStates.set(userId, {
        inCopyTradingFlow: true,
        lastInteractionTime: Date.now()
      });
    }

    const message = 'Welcome to the Copy Trading feature! ' +
      'Here you can follow top traders and replicate their strategies automatically.\n\n' +
      'Choose an option to get started:';

    // If we have a callback message, edit it
    if (ctx.callbackQuery && 'message' in ctx.callbackQuery) {
      await ctx.editMessageText(message, {
        reply_markup: getCopyTradingMenu()
      });
    } else {
      // Otherwise send a new message
      await ctx.reply(message, {
        reply_markup: getCopyTradingMenu()
      });
    }
  });

  // Button 1: Find top traders
  bot.action('find_top_traders', async (ctx) => {
    await ctx.answerCbQuery();

    // Set user state to waiting for token address
    const userId = ctx.from?.id;
    if (userId) {
      userStates.set(userId, {
        waitingForTokenAddress: true,
        inCopyTradingFlow: true,
        lastInteractionTime: Date.now()
      });
    }

    await ctx.editMessageText(
      "Please enter the token address you want to find top traders for.\n\n" +
      "Example: `CniPCE4b3s8gSUPhUiyMjXnytrEqUrMfSsnbBjLCpump`",
      {
        parse_mode: 'Markdown',
        reply_markup: getBackButton()
      }
    );
  });

  // Button 2: Enter wallet address to copy
  bot.action('enter_wallet_address', async (ctx) => {
    await ctx.answerCbQuery();

    // Set user state to waiting for wallet address
    const userId = ctx.from?.id;
    if (userId) {
      userStates.set(userId, {
        waitingForWalletAddress: true,
        inCopyTradingFlow: true,
        lastInteractionTime: Date.now()
      });
    }

    await ctx.editMessageText(
      "Please enter the wallet address you want to copy trade.\n\n" +
      "Example: `Gt4RRcMg2mzEN9SDtSUjEjezC9b1nXjEGDQyEVbrc7Sk`",
      {
        parse_mode: 'Markdown',
        reply_markup: getBackButton()
      }
    );
  });

  // Button 3: View tracked wallets
  bot.action('view_tracked_wallets', async (ctx) => {
    await ctx.answerCbQuery();

    // Update user state
    const userId = ctx.from?.id;
    if (userId) {
      updateUserInteractionTime(userId);
    }

    await ctx.deleteMessage();

    if (ctx.chat) {
      await listTrackedWallets(bot, ctx.chat.id);
    }
  });

  // Handle stop tracking callback
  bot.action(/stop_tracking_(.+)/, async (ctx) => {
    const walletAddress = ctx.match[1];
    await ctx.answerCbQuery(`Stopping tracking of ${walletAddress}`);

    // Update user state
    const userId = ctx.from?.id;
    if (userId) {
      updateUserInteractionTime(userId);
    }

    if (ctx.chat) {
      await stopWalletTracking(bot, ctx.chat.id, walletAddress);
    }
  });

  // Handle copy trader button presses
  bot.action(/copy_trader_(.+)/, async (ctx) => {
    const walletAddress = ctx.match[1];
    await ctx.answerCbQuery(`Starting to track ${walletAddress}`);

    // Update user state
    const userId = ctx.from?.id;
    if (userId) {
      updateUserInteractionTime(userId);
    }

    try {
      if (ctx.chat) {
        await startWalletTracking(bot, ctx.chat.id, walletAddress);
      }
    } catch (error) {
      console.error('Error starting wallet tracking:', error);
      await ctx.reply('Error setting up copy trading. Please try again later.', {
        reply_markup: getCopyTradingMenu()
      });
    }
  });

  // Handle token buy actions
  bot.action(/copy_trade_buy_(.+)$/, async (ctx) => {
    try {
      // Extract the token address from the callback data
      const tokenCA = ctx.match[1];

      // Update user state
      const userId = ctx.from?.id;
      if (userId) {
        updateUserInteractionTime(userId);
      }

      // Store the token address in the session
      (ctx as BotContext).session.tokenCA = tokenCA;

      // Answer the callback query
      await ctx.answerCbQuery();

      // Delete the previous message if applicable
      if (ctx.callbackQuery && 'message' in ctx.callbackQuery) {
        await ctx.deleteMessage();
      }

      // Process the token just like in your text handler
      const telegram_id = ctx.from.id.toString();

      const tokenData = await scanToken(tokenCA);
      if (!tokenData) {
        await ctx.reply('Token not found or invalid address.');
        return;
      }

      let quote;
      try {
        quote = await getQuote(tokenCA, true, 1e9); // Quote for 1 SOL
      } catch (error) {
        console.error('Error fetching quote:', error);
        quote = { error: true };
      }

      const formattedResponse = await formatTokenResponse(tokenData, quote, telegram_id);

      const keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback('0.1 SOL', 'buy_0.1'),
          Markup.button.callback('0.5 SOL', 'buy_0.5'),
          Markup.button.callback('1 SOL', 'buy_1')
        ],
        [
          Markup.button.callback('2 SOL', 'buy_2'),
          Markup.button.callback('5 SOL', 'buy_5'),
          Markup.button.callback('10 SOL', 'buy_10')
        ],
        [
          Markup.button.callback('Custom Amount', 'buy_custom')
        ],
        [Markup.button.callback('Back to Trade Menu', 'trade')]
      ]);

      await ctx.reply(formattedResponse, {
        parse_mode: "MarkdownV2",
        reply_markup: keyboard.reply_markup
      });

    } catch (error) {
      console.error('Error in copy trade buy action:', error);
      await ctx.answerCbQuery('An error occurred. Please try again.');
    }
  });

  // Handle text messages (for entering addresses) - with proper state checking
  bot.on('text', async (ctx, next) => {
    const userId = ctx.from.id;
    const userState = userStates.get(userId);

    // Check if state has timed out
    if (hasUserStateTimedOut(userId)) {
      // Clear the state and let other handlers process the message
      userStates.delete(userId);
      return next();
    }

    // Only process messages if user is in copy trading flow
    if (!userState?.inCopyTradingFlow) {
      return next(); // Pass to next handler (like /start)
    }

    console.log(`Processing text in copy trading flow for user ${userId}`);

    // Update interaction time
    updateUserInteractionTime(userId);

    // Handle token address input for finding top traders
    if (userState.waitingForTokenAddress) {
      const tokenAddress = ctx.message.text.trim();

      // Update the state - keep in copy trading flow but no longer waiting for token
      userStates.set(userId, {
        inCopyTradingFlow: true,
        lastInteractionTime: Date.now()
      });

      // Show typing indicator while fetching data
      await ctx.telegram.sendChatAction(ctx.chat.id, 'typing');

      try {
        const traders = await getTopTraders(tokenAddress);

        if (traders.length === 0) {
          await ctx.reply('No top traders found for this token.', {
            reply_markup: getCopyTradingMenu()
          });
          return;
        }

        const message = formatTradersMessage(traders);
        await ctx.replyWithMarkdown(message);

        // Offer copy trading options
        await ctx.reply('Would you like to copy trade one of these wallets?', {
          reply_markup: {
            inline_keyboard: [
              ...traders.map((trader, index) => [{
                text: `Copy Trader ${index + 1} (${trader.owner.slice(0, 6)}...)`,
                callback_data: `copy_trader_${trader.owner}`
              }]),
              [{
                text: "« Back to Copy Trading Menu",
                callback_data: "show_copy_menu"
              }]
            ]
          }
        });
      } catch (error) {
        console.error('Error:', error);
        await ctx.reply('Error fetching top traders. Please check the token address and try again.', {
          reply_markup: getCopyTradingMenu()
        });
      }
      return;
    }

    // Handle wallet address input for direct copy trading
    if (userState.waitingForWalletAddress) {
      const walletAddress = ctx.message.text.trim();

      // Update the state - keep in copy trading flow but no longer waiting for wallet
      userStates.set(userId, {
        inCopyTradingFlow: true,
        lastInteractionTime: Date.now()
      });

      try {
        await startWalletTracking(bot, ctx.chat.id, walletAddress);
      } catch (error) {
        console.error('Error starting wallet tracking:', error);
        await ctx.reply('Error setting up wallet tracking. Please try again later.', {
          reply_markup: getCopyTradingMenu()
        });
      }
      return;
    }

    // If user is in copy trading flow but we don't know what to do with their message
    if (userState.inCopyTradingFlow) {
      await ctx.reply(
        "I'm not sure what you want to do. Please use the menu buttons to navigate.",
        { reply_markup: getCopyTradingMenu() }
      );
      return;
    }

    // If not in copy trading flow, pass to next handler
    return next();
  });

  // Handle application shutdown
  process.on('SIGINT', async () => {
    console.log('Application shutting down, stopping all trackers...');
    if (trackerInitialized) {
      trackerService.stopAllTracking();
    }
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('Application shutting down, stopping all trackers...');
    if (trackerInitialized) {
      trackerService.stopAllTracking();
    }
    process.exit(0);
  });
};

export default copyTrading;