import mongoose, { Schema, Document } from "mongoose";

// Interface for individual trades
export interface ITrade {
    tokenAddress: string;
    tokenName: string;
    tokenSymbol: string;
    buyPrice: number;
    tokenAmount: number;
    solSpent: number;
    currentPrice: number;
    solPnL: number;
    usdPnL: number;
    timestamp: Date;
}

// Interface for positions
export interface IPosition {
    tokenAddress: string;
    tokenName: string;
    tokenSymbol: string;
    totalTokens: number;
    totalSolSpent: number;
    trades: ITrade[];
    averageBuyPrice: number;
    currentPrice: number;
    solPnL: number;
    usdPnL: number;
}

// Define Trade Schema
const tradeSchema = new Schema({
    tokenAddress: {
        type: String,
        required: true
    },
    tokenName: {
        type: String,
        required: true
    },
    tokenSymbol: {
        type: String,
        required: true
    },
    buyPrice: {
        type: Number,
        required: true
    },
    tokenAmount: {
        type: Number,
        required: true
    },
    solSpent: {
        type: Number,
        required: true
    },
    currentPrice: {
        type: Number,
        required: true
    },
    solPnL: {
        type: Number,
        default: 0
    },
    usdPnL: {
        type: Number,
        default: 0
    },
    timestamp: {
        type: Date,
        default: Date.now
    }
});

// Define Position Schema
const positionSchema = new Schema({
    tokenAddress: {
        type: String,
        required: true
    },
    tokenName: {
        type: String,
        required: true
    },
    tokenSymbol: {
        type: String,
        required: true
    },
    totalTokens: {
        type: Number,
        required: true,
        default: 0
    },
    totalSolSpent: {
        type: Number,
        required: true,
        default: 0
    },
    averageBuyPrice: {
        type: Number,
        required: true,
        default: 0
    },
    currentPrice: {
        type: Number,
        required: true,
        default: 0
    },
    solPnL: {
        type: Number,
        default: 0
    },
    usdPnL: {
        type: Number,
        default: 0
    }
});

// Updated User Interface
export interface IUser extends Document {
    telegram_id: string;
    privateKey: string;
    walletAddress: string;
    userBalance: number;
    lastUpdatedbalance: Date | null;
    trades: ITrade[];
    positions?: IPosition[];
    addTrade: (trade: ITrade) => Promise<void>;
    getPositions: () => Promise<IPosition[]>;
}

// Define User Schema
const userSchema = new Schema({
    telegram_id: {
        type: String,
        required: true,
        unique: true
    },
    privateKey: {
        type: String,
        required: true
    },
    walletAddress: {
        type: String,
        required: true
    },
    userBalance: {
        type: Number,
        default: 0
    },
    lastUpdatedbalance: {
        type: Date,
        default: null
    },
    trades: [tradeSchema],
    positions: [positionSchema]
}, {
    timestamps: true
});

// Add method to save new trade
userSchema.methods.addTrade = async function (trade: ITrade): Promise<void> {
    this.trades.push(trade);
    await this.save();
};

// Add method to get positions
userSchema.methods.getPositions = async function (): Promise<IPosition[]> {
    // Group trades by token address and calculate position metrics
    const positions = new Map<string, IPosition>();

    this.trades.forEach((trade: ITrade) => {
        const key = trade.tokenAddress;
        const current = positions.get(key) || {
            tokenAddress: trade.tokenAddress,
            tokenName: trade.tokenName,
            tokenSymbol: trade.tokenSymbol,
            totalTokens: 0,
            totalSolSpent: 0,
            trades: [],
            averageBuyPrice: 0,
            currentPrice: trade.currentPrice,
            solPnL: 0,
            usdPnL: 0
        };

        current.totalTokens += trade.tokenAmount;
        current.totalSolSpent += trade.solSpent;
        current.trades.push(trade);
        current.averageBuyPrice = current.totalSolSpent / current.totalTokens;
        current.currentPrice = trade.currentPrice;

        positions.set(key, current);
    });

    return Array.from(positions.values());
};

const User = mongoose.model<IUser>("User", userSchema);

export default User;