import mongoose, { Schema, Document } from "mongoose";

// Interface for individual trades
export interface ITrade {
    tokenAddress: string;
    tokenName: string;
    tokenSymbol: string;
    buyPrice: number;
    tokenAmount: number;
    solSpent: number;
    usdSpent?: number; // New field for USD value of trade
    currentPrice: number;
    solPnL: number;
    usdPnL: number;
    entryMarketCap: number;
    timestamp: Date;
}

// Interface for positions
export interface IPosition {
    tokenAddress: string;
    tokenName: string;
    tokenSymbol: string;
    totalTokens: number;
    totalSolSpent: number;
    totalUsdSpent?: number; // New field for total USD spent
    trades: ITrade[];
    averageBuyPrice: number;
    currentPrice: number;
    solPnL: number;
    usdPnL: number;
    currentMarketCap: number;
    entryMarketCap: number;
    lastPriceUpdate?: Date;
    currentUsdValue?: number; // New field for current USD value
}

// Define Trade Schema
const tradeSchema = new Schema({
    tokenAddress: { type: String, required: true },
    tokenName: { type: String, required: true },
    tokenSymbol: { type: String, required: true },
    buyPrice: { type: Number, required: true },
    tokenAmount: { type: Number, required: true },
    solSpent: { type: Number, required: true },
    usdSpent: { type: Number, required: false }, // New field for USD spending
    currentPrice: { type: Number, required: true },
    solPnL: { type: Number, default: 0 },
    usdPnL: { type: Number, default: 0 },
    timestamp: { type: Date, default: Date.now },
    entryMarketCap: { type: Number, required: true, default: 0 }
});

// Define Position Schema
const positionSchema = new Schema({
    tokenAddress: { type: String, required: true },
    tokenName: { type: String, required: true },
    tokenSymbol: { type: String, required: true },
    totalTokens: { type: Number, required: true, default: 0 },
    totalSolSpent: { type: Number, required: true, default: 0 },
    totalUsdSpent: { type: Number, required: false }, // New field for USD spending total
    trades: [tradeSchema],
    averageBuyPrice: { type: Number, required: true, default: 0 },
    currentPrice: { type: Number, required: true, default: 0 },
    solPnL: { type: Number, default: 0 },
    usdPnL: { type: Number, default: 0 },
    currentMarketCap: { type: Number, required: true, default: 0 },
    entryMarketCap: { type: Number, required: true, default: 0 },
    lastPriceUpdate: { type: Date, default: Date.now, required: false },
    currentUsdValue: { type: Number, required: false } // New field for current USD value
});

// Updated User Interface
export interface IUser extends Document {
    telegram_id: string;
    privateKey: string;
    walletAddress: string;
    userBalance: number;
    lastUpdatedbalance: Date | null;
    trades: ITrade[];
    positions: IPosition[];
    addTrade: (trade: ITrade) => Promise<void>;
    getPositions: () => Promise<IPosition[]>;
}

// Define User Schema
const userSchema = new Schema({
    telegram_id: { type: String, required: true, unique: true },
    privateKey: { type: String, required: true },
    walletAddress: { type: String, required: true },
    userBalance: { type: Number, default: 0 },
    lastUpdatedbalance: { type: Date, default: null },
    trades: [tradeSchema],
    positions: [positionSchema]
}, {
    timestamps: true
});

// Add method to save new trade
userSchema.methods.addTrade = async function (trade: ITrade): Promise<void> {
    this.trades.push(trade);

    let position = this.positions?.find((p: IPosition) => p.tokenAddress === trade.tokenAddress);

    if (position) {
        // Update existing position
        position.totalTokens += trade.tokenAmount;
        position.totalSolSpent += trade.solSpent;
        // Update USD spent if available
        if (trade.usdSpent) {
            position.totalUsdSpent = (position.totalUsdSpent || 0) + trade.usdSpent;
        }
        position.currentPrice = trade.currentPrice;
        position.currentMarketCap = trade.entryMarketCap;
        position.trades.push(trade);
        position.lastPriceUpdate = new Date(); // Update timestamp

        if (position.totalTokens > 0) {
            position.averageBuyPrice = Math.abs(position.totalSolSpent / position.totalTokens);
            const solValueAtCurrentPrice = position.totalTokens * position.currentPrice;
            position.solPnL = solValueAtCurrentPrice - position.totalSolSpent;

            // Calculate USD values if possible
            if (trade.usdSpent) {
                position.currentUsdValue = solValueAtCurrentPrice * (trade.usdSpent / trade.solSpent);
                position.usdPnL = position.currentUsdValue - (position.totalUsdSpent || 0);
            }
        }
    } else if (trade.tokenAmount > 0) {
        // Create new position with lastPriceUpdate and USD fields
        const newPosition: IPosition = {
            tokenAddress: trade.tokenAddress,
            tokenName: trade.tokenName,
            tokenSymbol: trade.tokenSymbol,
            totalTokens: trade.tokenAmount,
            totalSolSpent: trade.solSpent,
            totalUsdSpent: trade.usdSpent, // Add USD spent if available
            trades: [trade],
            averageBuyPrice: trade.buyPrice,
            currentPrice: trade.currentPrice,
            solPnL: 0,
            usdPnL: 0,
            currentMarketCap: trade.entryMarketCap,
            entryMarketCap: trade.entryMarketCap,
            lastPriceUpdate: new Date(),
            currentUsdValue: trade.usdSpent // Initialize current USD value if available
        };
        this.positions.push(newPosition);
    }

    await this.save();
};

// Add method to get positions
userSchema.methods.getPositions = async function (): Promise<IPosition[]> {
    const positions = new Map<string, IPosition>();

    this.trades.forEach((trade: ITrade) => {
        const key = trade.tokenAddress;
        const current = positions.get(key) || {
            tokenAddress: trade.tokenAddress,
            tokenName: trade.tokenName,
            tokenSymbol: trade.tokenSymbol,
            totalTokens: 0,
            totalSolSpent: 0,
            totalUsdSpent: 0, // Initialize USD spent
            trades: [],
            averageBuyPrice: 0,
            currentPrice: trade.currentPrice,
            solPnL: 0,
            usdPnL: 0,
            entryMarketCap: trade.entryMarketCap,
            currentMarketCap: 0,
            lastPriceUpdate: new Date(), // Include lastPriceUpdate
            currentUsdValue: 0 // Initialize current USD value
        };

        current.totalTokens += trade.tokenAmount;
        current.totalSolSpent += trade.solSpent;

        // Add USD spent if available
        if (trade.usdSpent) {
            current.totalUsdSpent! += trade.usdSpent;
        }

        current.trades.push(trade);
        current.averageBuyPrice = current.totalSolSpent / current.totalTokens;
        current.currentPrice = trade.currentPrice;

        positions.set(key, current);
    });

    return Array.from(positions.values());
};

const User = mongoose.model<IUser>("User", userSchema);

export default User;