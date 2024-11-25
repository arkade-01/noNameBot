import mongoose from "mongoose";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Check for the required environment variable
if (!process.env.DB_URL) {
    throw new Error("DB_URL is not defined in the environment variables");
}

// Use the url from the environment variable
const url = process.env.DB_URL as string

// Create a function to connect to the database
const connectToDatabase = async () => {
    try {
        const app = await mongoose.connect(url);
        console.log("Connected to MongoDB successfully!");
        return app;
    } catch (error) {
        console.error("Failed to connect to MongoDB:", error);
        process.exit(1); // Exit the process with failure
    }
};

// // Call the connection function
// connectToDatabase();
export default connectToDatabase;
