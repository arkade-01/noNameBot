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

// New interface for token sales (for alerts only)
export interface TokenSale {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  amount: number;
  logoURI?: string;
  saleTime: string;
  txHash: string;
}

/**
 * Enhanced API client for BirdEye with proper response handling
 * This handles common API issues such as rate limiting, slow responses, and intermittent failures
 */
export class BirdEyeClient {
  // All the existing code remains the same
  private apiKey: string;
  private baseUrl: string = 'https://public-api.birdeye.so';
  private maxRetries: number = 3;
  private retryDelay: number = 2000;
  private timeout: number = 30000; // 30 seconds timeout

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

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

  private async executeWithRetry<T>(config: AxiosRequestConfig): Promise<T> {
    let lastError: Error | null = null;
    let retryCount = 0;

    while (retryCount <= this.maxRetries) {
      try {
        const response = await axios(config);
        if (response.data && response.data.success === false) {
          throw new Error(`API returned error: ${JSON.stringify(response.data)}`);
        }
        return response.data as T;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (axios.isAxiosError(error)) {
          const axiosError = error as AxiosError;
          if (axiosError.response?.status === 429) {
            console.log('Rate limited by API, backing off...');
            await this.delay(this.retryDelay * 2);
            retryCount++;
            continue;
          }
          if (axiosError.code === 'ECONNABORTED' || axiosError.code === 'ETIMEDOUT') {
            console.log(`Request timeout (attempt ${retryCount + 1}/${this.maxRetries + 1}), retrying...`);
            config.timeout = this.timeout * (retryCount + 1.5);
            await this.delay(this.retryDelay);
            retryCount++;
            continue;
          }
          if (axiosError.response && axiosError.response.status >= 500) {
            console.log(`Server error ${axiosError.response.status} (attempt ${retryCount + 1}/${this.maxRetries + 1}), retrying...`);
            await this.delay(this.retryDelay);
            retryCount++;
            continue;
          }
        }

        if (lastError.message.includes('ENETUNREACH') ||
          lastError.message.includes('ETIMEDOUT') ||
          lastError.message.includes('ECONNRESET')) {
          console.log(`Network error (attempt ${retryCount + 1}/${this.maxRetries + 1}): ${lastError.message}, retrying...`);
          await this.delay(this.retryDelay);
          retryCount++;
          continue;
        }

        throw lastError;
      }
    }
    throw lastError || new Error('Maximum retries exceeded');
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

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
  private initializationTime: Date;
  private processedTxHashes: Set<string> = new Set();

  constructor(walletAddress: string, apiKey: string, pollingIntervalMs: number = 30000, debug: boolean = false) {
    super();
    this.walletAddress = walletAddress;
    this.apiClient = new BirdEyeClient(apiKey);
    this.pollingIntervalMs = pollingIntervalMs;
    this.debug = debug;
    this.initializationTime = new Date();

    this.apiClient.configure({
      timeout: 30000,
      maxRetries: 3,
      retryDelay: 2000
    });
  }

  public startTracking(): void {
    if (this.isTracking) {
      console.log("Tracking already in progress");
      return;
    }

    this.knownTokenAddresses.clear();
    this.processedTxHashes.clear();
    this.initializationTime = new Date(Date.now() - 60000);
    console.log(`Setting initialization time to ${this.initializationTime.toISOString()}`);

    this.isTracking = true;
    console.log(`Starting to track wallet ${this.walletAddress}`);

    this.checkForNewTransactions();

    const pollingInterval = Math.min(this.pollingIntervalMs, 15000);
    this.pollingTimer = setInterval(() => {
      this.checkForNewTransactions();
    }, pollingInterval);

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
    this.processedTxHashes.clear();
    this.emit('tracking:stopped', { walletAddress: this.walletAddress });
  }

  /**
   * Modified checkForNewTransactions method to detect both purchases and sales
   */
  private async checkForNewTransactions(): Promise<void> {
    try {
      console.log(`Checking for new transactions for wallet ${this.walletAddress}...`);

      // Get transactions
      const apiResponse = await this.apiClient.getWalletTransactions(this.walletAddress, 50);
      const transactions: Transaction[] = apiResponse.data.solana || [];

      if (this.debug) {
        console.log(`Fetched ${transactions.length} recent transactions for ${this.walletAddress}`);
        const actions = new Set<string>();
        transactions.forEach(tx => actions.add(tx.mainAction));
        console.log(`Transaction types found: ${Array.from(actions).join(', ')}`);
      }

      // Sort transactions by blockTime (newest first)
      transactions.sort((a, b) => new Date(b.blockTime).getTime() - new Date(a.blockTime).getTime());

      // Filter transactions that occurred before tracking started AND 
      // transactions we've already processed
      const newTransactions = transactions.filter(tx => {
        if (this.processedTxHashes.has(tx.txHash)) {
          if (this.debug) console.log(`Skipping already processed tx ${tx.txHash.substring(0, 8)}`);
          return false;
        }

        const txTime = new Date(tx.blockTime);
        if (txTime <= this.initializationTime) {
          if (this.debug) console.log(`Skipping historical tx ${tx.txHash.substring(0, 8)} from ${txTime.toISOString()}`);
          return false;
        }

        return true;
      });

      if (this.debug) {
        console.log(`Found ${newTransactions.length} new transactions after filtering`);
      }

      if (newTransactions.length === 0) {
        return;
      }

      // Mark all new transactions as processed to prevent duplicates
      newTransactions.forEach(tx => {
        this.processedTxHashes.add(tx.txHash);
      });

      // Process new transactions to find token purchases and sales
      const newPurchases: TokenInfo[] = [];
      const newSales: TokenSale[] = [];

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

        // Look for tokens flowing in (positive balance changes)
        const incomingTokens = tx.balanceChange.filter(tokenChange =>
          tokenChange.amount > 0 &&
          tokenChange.address !== "So11111111111111111111111111111111111111112" &&
          tokenChange.symbol !== "SOL"
        );

        // Look for tokens flowing out (negative balance changes)
        const outgoingTokens = tx.balanceChange.filter(tokenChange =>
          tokenChange.amount < 0 &&
          tokenChange.address !== "So11111111111111111111111111111111111111112" &&
          tokenChange.symbol !== "SOL"
        );

        // Process incoming tokens (purchases)
        if (incomingTokens.length > 0) {
          if (this.debug) {
            console.log(`Found ${incomingTokens.length} incoming tokens in tx ${tx.txHash.substring(0, 8)}...`);
          }

          for (const tokenChange of incomingTokens) {
            if (this.debug) {
              console.log(`Token purchase detected: ${tokenChange.symbol} (${tokenChange.address})`);
            }

            // Add to purchases
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
          }
        }

        // Process outgoing tokens (sales)
        if (outgoingTokens.length > 0) {
          if (this.debug) {
            console.log(`Found ${outgoingTokens.length} outgoing tokens in tx ${tx.txHash.substring(0, 8)}...`);
          }

          for (const tokenChange of outgoingTokens) {
            if (this.debug) {
              console.log(`Token sale detected: ${tokenChange.symbol} (${tokenChange.address})`);
            }

            // Add to sales (note the negative amount is made positive for easier reading)
            newSales.push({
              address: tokenChange.address,
              symbol: tokenChange.symbol || "Unknown",
              name: tokenChange.name || "Unknown Token",
              decimals: tokenChange.decimals || 0,
              amount: Math.abs(tokenChange.amount), // Convert to positive number
              logoURI: tokenChange.logoURI,
              saleTime: tx.blockTime,
              txHash: tx.txHash
            });
          }
        }
      }

      // Emit events for token purchases
      if (newPurchases.length > 0) {
        console.log(`Detected ${newPurchases.length} token purchases after tracking began`);

        newPurchases.forEach(token => {
          const formattedAmount = (token.amount / Math.pow(10, token.decimals)).toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 6
          });
          console.log(`Emitting token:purchased event for ${formattedAmount} ${token.symbol}`);
          this.emit('token:purchased', token);
        });

        this.emit('purchases:detected', {
          count: newPurchases.length,
          tokens: newPurchases,
          timestamp: new Date().toISOString()
        });
      }

      // Emit events for token sales
      if (newSales.length > 0) {
        console.log(`Detected ${newSales.length} token sales after tracking began`);

        newSales.forEach(token => {
          const formattedAmount = (token.amount / Math.pow(10, token.decimals)).toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 6
          });
          console.log(`Emitting token:sold event for ${formattedAmount} ${token.symbol}`);
          this.emit('token:sold', token);
        });

        this.emit('sales:detected', {
          count: newSales.length,
          tokens: newSales,
          timestamp: new Date().toISOString()
        });
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

  public setDebug(enabled: boolean): void {
    this.debug = enabled;
  }

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
    this.isInitialized = true;
    console.log('Wallet tracker service initialized');
    return Promise.resolve();
  }

  /**
   * Start tracking a wallet for a specific user
   */
  async startTrackingForUser(telegramId: string, walletAddress: string, pollingInterval: number = 30000): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('WalletTrackerService not initialized. Call initialize() first.');
    }

    // Check if we already have a tracker for this wallet
    if (this.trackers.has(walletAddress)) {
      console.log(`Tracker for wallet ${walletAddress} already exists`);
      this.addUserToWallet(telegramId, walletAddress);
      return;
    }

    const user = await this.findOrCreateUser(telegramId, walletAddress);
    const tracker = new WalletTracker(walletAddress, this.apiKey, pollingInterval, this.debug);

    // Set up event handlers for purchases
    tracker.on('token:purchased', async (tokenInfo: TokenInfo) => {
      try {
        await this.handleTokenPurchase(telegramId, tokenInfo);
      } catch (error) {
        console.error(`Error handling token purchase for user ${telegramId}:`, error);
      }
    });

    // Set up event handlers for sales (for alerts only)
    tracker.on('token:sold', async (tokenInfo: TokenSale) => {
      try {
        await this.handleTokenSale(telegramId, tokenInfo);
      } catch (error) {
        console.error(`Error handling token sale for user ${telegramId}:`, error);
      }
    });

    tracker.on('error', (error) => {
      console.error(`Tracking error for wallet ${walletAddress}:`, error);
    });

    this.trackers.set(walletAddress, tracker);
    this.addUserToWallet(telegramId, walletAddress);
    tracker.startTracking();
    console.log(`Started tracking wallet ${walletAddress} for user ${telegramId}`);
  }

  /**
   * Associate a user with a wallet being tracked
   */
  private addUserToWallet(telegramId: string, walletAddress: string): void {
    if (!this.userTokenMap.has(telegramId)) {
      this.userTokenMap.set(telegramId, new Set());
    }
    this.userTokenMap.get(telegramId)!.add(walletAddress);
  }

  /**
   * Remove a user from a wallet being tracked
   */
  private removeUserFromWallet(telegramId: string, walletAddress: string): void {
    if (this.userTokenMap.has(telegramId)) {
      const wallets = this.userTokenMap.get(telegramId)!;
      wallets.delete(walletAddress);

      if (wallets.size === 0) {
        this.userTokenMap.delete(telegramId);
      }
    }
  }

  /**
   * Stop tracking a specific wallet
   */
  stopTracking(walletAddress: string): void {
    const tracker = this.trackers.get(walletAddress);
    if (tracker) {
      tracker.stopTracking();
      this.trackers.delete(walletAddress);
      console.log(`Stopped tracking wallet ${walletAddress}`);

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
   */
  private async findOrCreateUser(telegramId: string, walletAddress: string): Promise<IUser> {
    let user = await User.findOne({ telegram_id: telegramId });

    if (!user) {
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
      user.walletAddress = walletAddress;
      await user.save();
      console.log(`Updated wallet address for user ${telegramId}`);
    }

    return user;
  }

  /**
   * Handle a token purchase event
   */
  private async handleTokenPurchase(telegramId: string, tokenInfo: TokenInfo): Promise<void> {
    try {
      const user = await User.findOne({ telegram_id: telegramId });
      if (!user) {
        console.error(`User with telegram ID ${telegramId} not found`);
        return;
      }

      const formattedAmount = tokenInfo.amount / Math.pow(10, tokenInfo.decimals);

      try {
        const txDetails = await this.getDetailedTransactionInfo(tokenInfo.txHash, tokenInfo.address);

        const tradeInfo: ITrade = {
          tokenAddress: tokenInfo.address,
          tokenName: tokenInfo.name,
          tokenSymbol: tokenInfo.symbol,
          buyPrice: txDetails.buyPrice || 0,
          tokenAmount: formattedAmount,
          solSpent: txDetails.solSpent || 0.1,
          usdSpent: txDetails.usdValue || 0,
          currentPrice: txDetails.buyPrice || 0,
          solPnL: 0,
          usdPnL: 0,
          entryMarketCap: txDetails.marketCap || 0,
          timestamp: new Date(tokenInfo.purchaseTime)
        };

        console.log(`Detected new token purchase for user ${telegramId}: ${formattedAmount} ${tokenInfo.symbol} (notification only)`);

        this.emit('token:purchased', {
          ...tokenInfo,
          trade: tradeInfo,
          telegramId: telegramId
        });

      } catch (error) {
        console.error(`Error getting detailed transaction info for ${tokenInfo.txHash}:`, error);

        const fallbackTradeInfo: ITrade = {
          tokenAddress: tokenInfo.address,
          tokenName: tokenInfo.name,
          tokenSymbol: tokenInfo.symbol,
          buyPrice: 0,
          tokenAmount: formattedAmount,
          solSpent: 0.1,
          currentPrice: 0,
          solPnL: 0,
          usdPnL: 0,
          entryMarketCap: 0,
          timestamp: new Date(tokenInfo.purchaseTime)
        };

        console.log(`Detected token purchase for user ${telegramId}: ${formattedAmount} ${tokenInfo.symbol} (notification only)`);
        this.emit('token:purchased', {
          ...tokenInfo,
          telegramId: telegramId
        });
      }

    } catch (error) {
      console.error(`Error processing token purchase for user ${telegramId}:`, error);
      throw error;
    }
  }

  /**
   * Handle a token sale event (for alerts only)
   */
  private async handleTokenSale(telegramId: string, tokenInfo: TokenSale): Promise<void> {
    try {
      const user = await User.findOne({ telegram_id: telegramId });
      if (!user) {
        console.error(`User with telegram ID ${telegramId} not found`);
        return;
      }

      const formattedAmount = tokenInfo.amount / Math.pow(10, tokenInfo.decimals);
      console.log(`Detected token sale for user ${telegramId}: ${formattedAmount} ${tokenInfo.symbol} (notification only)`);

      // Just emit the event for notification purposes, no action needed
      this.emit('token:sold', {
        ...tokenInfo,
        telegramId: telegramId
      });

    } catch (error) {
      console.error(`Error processing token sale for user ${telegramId}:`, error);
      throw error;
    }
  }

  /**
   * Get active trackers
   */
  getActiveTrackers(): string[] {
    return Array.from(this.trackers.keys());
  }

  /**
   * Get wallets tracked by a specific user
   */
  getWalletsTrackedByUser(telegramId: string): string[] {
    const wallets = this.userTokenMap.get(telegramId);
    if (!wallets) return [];
    return Array.from(wallets);
  }

  /**
   * Check if a wallet is being tracked
   */
  isTracking(walletAddress: string): boolean {
    return this.trackers.has(walletAddress) && this.trackers.get(walletAddress)!.isActive();
  }

  /**
   * Set debug mode for all trackers
   */
  setDebug(enabled: boolean): void {
    this.debug = enabled;
    for (const tracker of this.trackers.values()) {
      tracker.setDebug(enabled);
    }
  }

  /**
   * Get more detailed transaction information to improve trade data
   */
  private async getDetailedTransactionInfo(txHash: string, tokenAddress: string): Promise<{
    solSpent: number,
    usdValue: number,
    buyPrice: number,
    marketCap: number
  }> {
    // This is a placeholder implementation
    return {
      solSpent: 0.1,
      usdValue: 5,
      buyPrice: 0.0000001,
      marketCap: 1000000
    };
  }
}