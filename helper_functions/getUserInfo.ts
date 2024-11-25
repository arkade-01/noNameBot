import connectToDatabase from "../models/dbconfig";
import User from "../models/schema";
import createNewSolanaWallet from "./createWallet";

async function getUser(telegram_id: string) {
    await connectToDatabase();

    // Check if the user already exists
    const user = await User.findOne({ telegram_id });
    if (user) {
        console.log(`User found: ${user}`);
        return user;
    }

    // Create a new Solana wallet
    const newWallet = await createNewSolanaWallet(telegram_id);

    // Create and save a new user
    const newUser = new User({
        telegram_id,
        walletAddress: newWallet.address,
        privateKey: newWallet.private_key, // Fixed: Use the private key field
    });

    await newUser.save();
    console.log(`New user created: ${newUser}`);
    return newUser;
}

export default getUser;
