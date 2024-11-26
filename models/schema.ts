import mongoose, { Schema, Document } from "mongoose";

// Define User Schema
const userSchema = new Schema({
    telegram_id: { type: String, required: true, unique: true }, // Added `unique: true`
    privateKey: { type: String, required: true }, // Sensitive, handle with care
    walletAddress: { type: String, required: true },
    userBalance: {type: Number, default: 0},
    lastUpdatedbalance: {type: Date, default: null}
}, {
    timestamps: true, // Adds `createdAt` and `updatedAt` fields
});

// Define a User model interface
export interface IUser extends Document {
    telegram_id: string;
    privateKey: string;
    walletAddress: string;
    userBalance: number;
    lastUpdatedbalance: Date | null;
}

// Create the User model
const User = mongoose.model<IUser>("User", userSchema);

export default User;
