import axios, { AxiosError, AxiosRequestConfig } from "axios";
import { EventEmitter } from "events";
import mongoose from 'mongoose';
import User, { ITrade, IUser } from '../models/schema'; // Adjust import path as needed

// Define response types for the BirdEye API
interface BirdEyeApiResponse<T> {
  success: boolean;
  data: T;
}

interface TransactionsResponse {
  solana: Transaction[];
}

interface Transaction {
  txHash: string;
  blockTime: string;
  mainAction: string;
  status: boolean;
  balanceChange: BalanceChange[];
  from: string;
  to: string;
}

interface BalanceChange {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  amount: number;
  logoURI?: string;
  tokenAccount?: string;
  owner?: string;
  programId?: string;
}

export interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  amount: number;
  logoURI?: string;
  purchaseTime: string;
  txHash: string;
}

/**
 * Enhanced API client for BirdEye with proper response handling
 * This handles common API issues such as rate limiting, slow responses, and intermittent failures
 */
export class BirdEyeClient {
  private apiKey: string;
  private baseUrl: string = 'https://public-api.birdeye.so';
  private maxRetries: number = 3;
  private retryDelay: number = 2000;
  private timeout: number = 30000; // 30 seconds timeout

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }


  /**
   * Fetch wallet transactions with retry logic and timeout handling
   * @param walletAddress The wallet address to fetch transactions for
   * @param limit Maximum number of transactions to retrieve
   * @returns Promise with the API response data
   */
  async getWalletTransactions(walletAddress: string, limit: number = 50): Promise<BirdEyeApiResponse<TransactionsResponse>> {
    const config: AxiosRequestConfig = {
      method: 'GET',
      url: `${this.baseUrl}/v1/wallet/tx_list`,
      params: {
        wallet: walletAddress,
        limit: limit
      },
      headers: {
        accept: 'application/json',
        'x-chain': 'solana',
        'X-API-KEY': this.apiKey
      },
      timeout: this.timeout
    };

    return this.executeWithRetry<BirdEyeApiResponse<TransactionsResponse>>(config);
  }

  /**
   * Execute an API request with retry logic
   * @param config Axios request configuration
   * @returns Promise with the API response
   */
  private async executeWithRetry<T>(config: AxiosRequestConfig): Promise<T> {
    let lastError: Error | null = null;
    let retryCount = 0;

    while (retryCount <= this.maxRetries) {
      try {
        // Use a new axios instance each time to avoid potential instance-level issues
        const response = await axios(config);

        // Check if API returned success flag
        if (response.data && response.data.success === false) {
          throw new Error(`API returned error: ${JSON.stringify(response.data)}`);
        }

        return response.data as T;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // If it's an axios error, check specific conditions
        if (axios.isAxiosError(error)) {
          const axiosError = error as AxiosError;

          // Handle rate limiting (common with crypto APIs)
          if (axiosError.response?.status === 429) {
            console.log('Rate limited by API, backing off...');
            // Use a longer delay for rate limiting
            await this.delay(this.retryDelay * 2);
            retryCount++;
            continue;
          }

          // Handle timeout specifically
          if (axiosError.code === 'ECONNABORTED' || axiosError.code === 'ETIMEDOUT') {
            console.log(`Request timeout (attempt ${retryCount + 1}/${this.maxRetries + 1}), retrying...`);
            // Use progressively longer timeouts on retry
            config.timeout = this.timeout * (retryCount + 1.5);
            await this.delay(this.retryDelay);
            retryCount++;
            continue;
          }

          // Handle server errors (5xx) with retry
          if (axiosError.response && axiosError.response.status >= 500) {
            console.log(`Server error ${axiosError.response.status} (attempt ${retryCount + 1}/${this.maxRetries + 1}), retrying...`);
            await this.delay(this.retryDelay);
            retryCount++;
            continue;
          }
        }

        // For network errors, retry
        if (lastError.message.includes('ENETUNREACH') ||
          lastError.message.includes('ETIMEDOUT') ||
          lastError.message.includes('ECONNRESET')) {
          console.log(`Network error (attempt ${retryCount + 1}/${this.maxRetries + 1}): ${lastError.message}, retrying...`);
          await this.delay(this.retryDelay);
          retryCount++;
          continue;
        }

        // For non-retryable errors, throw immediately
        throw lastError;
      }
    }

    // If we've exhausted all retries
    throw lastError || new Error('Maximum retries exceeded');
  }

  /**
   * Simple promise-based delay function
   * @param ms Milliseconds to delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Configure client settings
   * @param options Configuration options
   */
  public configure(options: {
    maxRetries?: number;
    retryDelay?: number;
    timeout?: number;
    baseUrl?: string;
    httpAgent?: any;
    httpsAgent?: any;
  }): void {
    if (options.maxRetries !== undefined) this.maxRetries = options.maxRetries;
    if (options.retryDelay !== undefined) this.retryDelay = options.retryDelay;
    if (options.timeout !== undefined) this.timeout = options.timeout;
    if (options.baseUrl !== undefined) this.baseUrl = options.baseUrl;
  }
}

/**
 * Updated wallet tracker implementation that uses the enhanced BirdEye client
 */
export class WalletTracker extends EventEmitter {
  private walletAddress: string;
  private apiClient: BirdEyeClient;
  private pollingIntervalMs: number;
  private isTracking: boolean = false;
  private pollingTimer: NodeJS.Timeout | null = null;
  private lastSeenTxHash: string | null = null;
  private knownTokenAddresses: Set<string> = new Set();
  private debug: boolean = false;

  constructor(walletAddress: string, apiKey: string, pollingIntervalMs: number = 30000, debug: boolean = false) {
    super();
    this.walletAddress = walletAddress;
    this.apiClient = new BirdEyeClient(apiKey);
    this.pollingIntervalMs = pollingIntervalMs;
    this.debug = debug;

    // Configure client for optimal reliability
    this.apiClient.configure({
      timeout: 30000,    // 30 second timeout
      maxRetries: 3,     // 3 retries per request
      retryDelay: 2000   // 2 seconds between retries
    });
  }

  

  public startTracking(): void {
    if (this.isTracking) {
      console.log("Tracking already in progress");
      return;
    }

    this.isTracking = true;
    console.log(`Starting to track wallet ${this.walletAddress}`);

    // Immediately run first check
    this.checkForNewTransactions();

    // Set up regular polling
    this.pollingTimer = setInterval(() => {
      this.checkForNewTransactions();
    }, this.pollingIntervalMs);

    this.emit('tracking:started', { walletAddress: this.walletAddress });
  }

  public stopTracking(): void {
    if (!this.isTracking) {
      return;
    }

    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }

    this.isTracking = false;
    console.log(`Stopped tracking wallet ${this.walletAddress}`);
    this.emit('tracking:stopped', { walletAddress: this.walletAddress });
  }

  private async checkForNewTransactions(): Promise<void> {
    try {
      console.log(`Checking for new transactions for wallet ${this.walletAddress}...`);

      // Now properly typed
      const apiResponse = await this.apiClient.getWalletTransactions(this.walletAddress, 50);

      const transactions: Transaction[] = apiResponse.data.solana || [];

      if (this.debug) {
        console.log(`Fetched ${transactions.length} recent transactions for ${this.walletAddress}`);

        // Display the main actions for debugging
        const actions = new Set<string>();
        transactions.forEach(tx => actions.add(tx.mainAction));
        console.log(`Transaction types found: ${Array.from(actions).join(', ')}`);
      }

      // Sort transactions by blockTime (newest first)
      transactions.sort((a, b) => new Date(b.blockTime).getTime() - new Date(a.blockTime).getTime());

      // For debugging, log details of recent transactions
      if (this.debug) {
        const recentTxs = transactions.slice(0, 3);
        for (const tx of recentTxs) {
          console.log(`\nTransaction ${tx.txHash.substring(0, 8)}...`);
          console.log(`  Action: ${tx.mainAction}`);
          console.log(`  Time: ${tx.blockTime}`);
          console.log(`  Status: ${tx.status ? 'Success' : 'Failed'}`);
          console.log(`  From: ${tx.from}`);
          console.log(`  To: ${tx.to}`);
          console.log(`  Balance changes: ${tx.balanceChange ? tx.balanceChange.length : 0}`);

          // Log token movements
          if (tx.balanceChange && tx.balanceChange.length > 0) {
            tx.balanceChange.forEach(change => {
              if (!change.amount) return;
              const direction = change.amount > 0 ? "IN" : "OUT";
              const formattedAmount = change.amount / Math.pow(10, change.decimals || 9);
              console.log(`    ${direction}: ${formattedAmount.toFixed(6)} ${change.symbol || 'Unknown'} (${change.address})`);
            });
          }
        }
      }

      // Find new transactions (those we haven't seen before)
      const newTransactions = this.lastSeenTxHash
        ? transactions.filter(tx => {
          // Keep transactions until we hit the last seen one
          if (tx.txHash === this.lastSeenTxHash) return false;
          return true;
        })
        : transactions; // On first run, all are new

      if (this.debug) {
        console.log(`Found ${newTransactions.length} new transactions since last check`);
      }

      // Update the last seen tx hash if we have transactions
      if (transactions.length > 0) {
        this.lastSeenTxHash = transactions[0].txHash;
      }

      // Process new transactions to find token purchases
      const newPurchases: TokenInfo[] = [];

      for (const tx of newTransactions) {
        if (!tx.balanceChange || !Array.isArray(tx.balanceChange)) {
          if (this.debug) console.log(`Skipping tx ${tx.txHash.substring(0, 8)}... - No balance changes`);
          continue;
        }

        // Skip failed transactions
        if (!tx.status) {
          if (this.debug) console.log(`Skipping tx ${tx.txHash.substring(0, 8)}... - Failed transaction`);
          continue;
        }

        // Check if this is a buy/swap transaction
        const validActions = ['swap', 'receive', 'received', 'trade', 'buy', 'sell', 'transfer'];
        const isPurchase = validActions.includes(tx.mainAction.toLowerCase());

        if (this.debug) {
          console.log(`Transaction ${tx.txHash.substring(0, 8)}... with action ${tx.mainAction} - isPurchase: ${isPurchase}`);
        }

        // Process all transactions that have token balance changes
        // Look for tokens flowing in (positive balance changes)
        const incomingTokens = tx.balanceChange.filter(tokenChange =>
          tokenChange.amount > 0 &&
          tokenChange.address !== "So11111111111111111111111111111111111111112" &&
          tokenChange.symbol !== "SOL"
        );

        if (incomingTokens.length > 0) {
          if (this.debug) {
            console.log(`Found ${incomingTokens.length} incoming tokens in tx ${tx.txHash.substring(0, 8)}...`);
          }

          for (const tokenChange of incomingTokens) {
            // Skip already processed tokens
            if (this.knownTokenAddresses.has(tokenChange.address)) {
              if (this.debug) console.log(`  Skipping already processed token ${tokenChange.symbol}`);
              continue;
            }

            if (this.debug) {
              console.log(`  New token purchase detected: ${tokenChange.symbol} (${tokenChange.address})`);
            }

            // Found a new token purchase
            newPurchases.push({
              address: tokenChange.address,
              symbol: tokenChange.symbol || "Unknown",
              name: tokenChange.name || "Unknown Token",
              decimals: tokenChange.decimals || 0,
              amount: tokenChange.amount,
              logoURI: tokenChange.logoURI,
              purchaseTime: tx.blockTime,
              txHash: tx.txHash
            });

            // Add to known tokens so we don't trigger on it again
            this.knownTokenAddresses.add(tokenChange.address);
          }
        } else if (this.debug && tx.balanceChange.length > 0) {
          console.log(`No incoming tokens found in tx ${tx.txHash.substring(0, 8)}...`);
        }
      }

      if (newPurchases.length > 0) {
        console.log(`Detected ${newPurchases.length} new token purchases`);

        // Emit events for each new purchase
        newPurchases.forEach(token => {
          const formattedAmount = (token.amount / Math.pow(10, token.decimals)).toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 6
          });
          console.log(`Emitting token:purchased event for ${formattedAmount} ${token.symbol}`);
          this.emit('token:purchased', token);
        });

        // Also emit a summary event
        this.emit('purchases:detected', {
          count: newPurchases.length,
          tokens: newPurchases,
          timestamp: new Date().toISOString()
        });
      } else {
        console.log(`No new purchases detected`);
      }

    } catch (error) {
      console.error('Failed to fetch transactions:', error);
      this.emit('error', {
        message: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
        walletAddress: this.walletAddress
      });
    }
  }

  public isActive(): boolean {
    return this.isTracking;
  }

  public getWalletAddress(): string {
    return this.walletAddress;
  }

  public setPollingInterval(intervalMs: number): void {
    this.pollingIntervalMs = intervalMs;

    // If currently tracking, restart with new interval
    if (this.isTracking) {
      this.stopTracking();
      this.startTracking();
    }
  }

  public updateClientConfig(config: {
    timeout?: number;
    maxRetries?: number;
    retryDelay?: number;
    httpAgent?: any;
    httpsAgent?: any;
  }): void {
    this.apiClient.configure(config);
  }

  /**
   * Enable or disable debug logging
   */
  public setDebug(enabled: boolean): void {
    this.debug = enabled;
  }

  /**
   * Reset the known tokens list to force re-detection
   */
  public resetKnownTokens(): void {
    this.knownTokenAddresses.clear();
    console.log("Known tokens list has been reset");
  }
}

/**
 * Integrated wallet tracker service that connects BirdEye tracking with MongoDB storage
 */
export class WalletTrackerService extends EventEmitter {
  private trackers: Map<string, WalletTracker> = new Map();
  private apiKey: string;
  private isInitialized: boolean = false;
  private debug: boolean = false;
  private userTokenMap: Map<string, Set<string>> = new Map();

  constructor(apiKey: string, debug: boolean = false) {
    super();
    this.apiKey = apiKey;
    this.debug = debug;
  }

  /**
 * Initialize the wallet tracker service
 */
  async initialize(): Promise<void> {
    // Since your database connection is handled elsewhere,
    // we just need to mark this service as initialized
    this.isInitialized = true;
    console.log('Wallet tracker service initialized');
    return Promise.resolve();
  }

  /**
   * Start tracking a wallet for a specific user
   * @param telegramId Telegram ID of the user
   * @param walletAddress Wallet address to track
   * @param pollingInterval Interval in ms between checks (default: 30000ms = 30s)
   */
  async startTrackingForUser(telegramId: string, walletAddress: string, pollingInterval: number = 30000): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('WalletTrackerService not initialized. Call initialize() first.');
    }

    // Check if we already have a tracker for this wallet
    if (this.trackers.has(walletAddress)) {
      console.log(`Tracker for wallet ${walletAddress} already exists`);
      // Add this user to the set of users tracking this wallet
      this.addUserToWallet(telegramId, walletAddress);
      return;
    }

    // Find or create user in database
    const user = await this.findOrCreateUser(telegramId, walletAddress);

    // Create wallet tracker
    const tracker = new WalletTracker(walletAddress, this.apiKey, pollingInterval, this.debug);

    // Set up event handlers
    tracker.on('token:purchased', async (tokenInfo: TokenInfo) => {
      try {
        await this.handleTokenPurchase(telegramId, tokenInfo);
      } catch (error) {
        console.error(`Error handling token purchase for user ${telegramId}:`, error);
      }
    });

    tracker.on('error', (error) => {
      console.error(`Tracking error for wallet ${walletAddress}:`, error);
    });

    // Store tracker in map
    this.trackers.set(walletAddress, tracker);

    // Add this user to the list of users tracking this wallet
    this.addUserToWallet(telegramId, walletAddress);

    // Start tracking
    tracker.startTracking();
    console.log(`Started tracking wallet ${walletAddress} for user ${telegramId}`);
  }

  /**
   * Associate a user with a wallet being tracked
   */
  private addUserToWallet(telegramId: string, walletAddress: string): void {
    // Create a set for this user if it doesn't exist
    if (!this.userTokenMap.has(telegramId)) {
      this.userTokenMap.set(telegramId, new Set());
    }

    // Add this wallet to the user's set
    this.userTokenMap.get(telegramId)!.add(walletAddress);
  }

  /**
   * Remove a user from a wallet being tracked
   */
  private removeUserFromWallet(telegramId: string, walletAddress: string): void {
    if (this.userTokenMap.has(telegramId)) {
      const wallets = this.userTokenMap.get(telegramId)!;
      wallets.delete(walletAddress);

      // If user has no more wallets, remove the entry
      if (wallets.size === 0) {
        this.userTokenMap.delete(telegramId);
      }
    }
  }

  /**
   * Stop tracking a specific wallet
   * @param walletAddress The wallet address to stop tracking
   */
  stopTracking(walletAddress: string): void {
    const tracker = this.trackers.get(walletAddress);
    if (tracker) {
      tracker.stopTracking();
      this.trackers.delete(walletAddress);
      console.log(`Stopped tracking wallet ${walletAddress}`);

      // Remove all users from this wallet
      for (const [userId, wallets] of this.userTokenMap.entries()) {
        if (wallets.has(walletAddress)) {
          wallets.delete(walletAddress);
          if (wallets.size === 0) {
            this.userTokenMap.delete(userId);
          }
        }
      }
    }
  }

  /**
   * Stop all tracking for all wallets
   */
  stopAllTracking(): void {
    for (const [address, tracker] of this.trackers.entries()) {
      tracker.stopTracking();
      console.log(`Stopped tracking wallet ${address}`);
    }
    this.trackers.clear();
    this.userTokenMap.clear();
  }

  /**
   * Find user by telegram ID or create a new one if not exists
   * @param telegramId Telegram ID of the user
   * @param walletAddress Wallet address to associate with user
   */
  private async findOrCreateUser(telegramId: string, walletAddress: string): Promise<IUser> {
    let user = await User.findOne({ telegram_id: telegramId });

    if (!user) {
      // This is a simplified version - in a real implementation,
      // you would generate a private key more securely
      const dummyPrivateKey = "dummy_private_key_" + Date.now();

      user = new User({
        telegram_id: telegramId,
        privateKey: dummyPrivateKey,
        walletAddress: walletAddress,
        userBalance: 0,
        lastUpdatedbalance: null,
        trades: [],
        positions: []
      });

      await user.save();
      console.log(`Created new user with telegram ID ${telegramId}`);
    } else if (user.walletAddress !== walletAddress) {
      // Update wallet address if different
      user.walletAddress = walletAddress;
      await user.save();
      console.log(`Updated wallet address for user ${telegramId}`);
    }

    return user;
  }

  /**
   * Handle a token purchase event
   * @param telegramId Telegram ID of the user
   * @param tokenInfo Token purchase information
   */
  private async handleTokenPurchase(telegramId: string, tokenInfo: TokenInfo): Promise<void> {
    try {
      // Find the user
      const user = await User.findOne({ telegram_id: telegramId });
      if (!user) {
        console.error(`User with telegram ID ${telegramId} not found`);
        return;
      }

      // Format the amount with proper decimals
      const formattedAmount = tokenInfo.amount / Math.pow(10, tokenInfo.decimals);

      try {
        // Get detailed transaction information to improve data quality
        const txDetails = await this.getDetailedTransactionInfo(tokenInfo.txHash, tokenInfo.address);

        // Create a new trade object with the best available data
        const trade: ITrade = {
          tokenAddress: tokenInfo.address,
          tokenName: tokenInfo.name,
          tokenSymbol: tokenInfo.symbol,
          buyPrice: txDetails.buyPrice || 0,
          tokenAmount: formattedAmount,
          solSpent: txDetails.solSpent || 0.1, // Use transaction data or fallback
          usdSpent: txDetails.usdValue || 0,
          currentPrice: txDetails.buyPrice || 0, // Initially current price = buy price
          solPnL: 0, // Will be calculated later as positions update
          usdPnL: 0, // Will be calculated later as positions update
          entryMarketCap: txDetails.marketCap || 0,
          timestamp: new Date(tokenInfo.purchaseTime)
        };

        // Add the trade to the user's trades
        await user.addTrade(trade);

        console.log(`Added new trade for user ${telegramId}: ${formattedAmount} ${tokenInfo.symbol}`);

        // Emit an event with the token info and trade details
        // This will allow the telegram bot to respond appropriately
        this.emit('token:purchased', {
          ...tokenInfo,
          trade: trade,
          telegramId: telegramId
        });

      } catch (error) {
        console.error(`Error getting detailed transaction info for ${tokenInfo.txHash}:`, error);

        // Create a minimal trade record if we can't get detailed info
        const fallbackTrade: ITrade = {
          tokenAddress: tokenInfo.address,
          tokenName: tokenInfo.name,
          tokenSymbol: tokenInfo.symbol,
          buyPrice: 0,
          tokenAmount: formattedAmount,
          solSpent: 0.1, // Placeholder
          currentPrice: 0,
          solPnL: 0,
          usdPnL: 0,
          entryMarketCap: 0,
          timestamp: new Date(tokenInfo.purchaseTime)
        };

        // Add the fallback trade
        await user.addTrade(fallbackTrade);
        console.log(`Added fallback trade for user ${telegramId}: ${formattedAmount} ${tokenInfo.symbol}`);

        // Still emit the event so the user gets notified
        this.emit('token:purchased', {
          ...tokenInfo,
          telegramId: telegramId  // Add this line to include the Telegram ID
        });
      }

    } catch (error) {
      console.error(`Error saving token purchase for user ${telegramId}:`, error);
      throw error;
    }
  }

  /**
   * Get active trackers
   * @returns Array of active wallet addresses being tracked
   */
  getActiveTrackers(): string[] {
    return Array.from(this.trackers.keys());
  }

  /**
   * Get wallets tracked by a specific user
   * @param telegramId The telegram ID of the user
   * @returns Array of wallet addresses being tracked by this user
   */
  getWalletsTrackedByUser(telegramId: string): string[] {
    const wallets = this.userTokenMap.get(telegramId);
    if (!wallets) return [];
    return Array.from(wallets);
  }

  /**
   * Check if a wallet is being tracked
   * @param walletAddress Wallet address to check
   * @returns Boolean indicating if the wallet is being tracked
   */
  isTracking(walletAddress: string): boolean {
    return this.trackers.has(walletAddress) && this.trackers.get(walletAddress)!.isActive();
  }

  /**
   * Set debug mode for all trackers
   * @param enabled Whether to enable debug mode
   */
  setDebug(enabled: boolean): void {
    this.debug = enabled;
    for (const tracker of this.trackers.values()) {
      tracker.setDebug(enabled);
    }
  }

  /**
   * Get more detailed transaction information to improve trade data
   * This is a placeholder for where you would implement more detailed analysis
   * @param txHash Transaction hash
   * @param tokenAddress Token address
   */
  private async getDetailedTransactionInfo(txHash: string, tokenAddress: string): Promise<{
    solSpent: number,
    usdValue: number,
    buyPrice: number,
    marketCap: number
  }> {
    // In a real implementation, you would:
    // 1. Call another API to get transaction details
    // 2. Calculate the exact SOL spent
    // 3. Convert to USD value using SOL price
    // 4. Calculate token buy price
    // 5. Get market cap if available

    // This is a placeholder implementation
    return {
      solSpent: 0.1,
      usdValue: 5,
      buyPrice: 0.0000001,
      marketCap: 1000000
    };
  }
}