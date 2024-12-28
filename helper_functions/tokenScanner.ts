import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const base_url = process.env.BASE_URL2 as string;
const api_key = process.env.API_KEY as string;

interface TokenInfo {
    price: number;
    supplyAmount: number;
    mktCap: number;
}

interface AuditRisk {
    mintDisabled: boolean;
    freezeDisabled: boolean;
    lpBurned: boolean;
    top10Holders: boolean;
}

interface TokenData {
    address: string;
    deployTime: string;
    externals: string;
    liquidityList: object[];
    ownersList: object[];
    score: number;
    tokenImg: string;
    tokenName: string;
    tokenSymbol: string;
    auditRisk: AuditRisk; // Audit risk details
}

interface tokenDetails {
    tokenData: TokenData;
    tokenInfo: TokenInfo;
}

// Define the filtered response type
interface FilteredTokenResponse {
    address: string;
    tokenName: string;
    tokenSymbol: string;
    score: number;
    auditRisk: AuditRisk;
    tokenInfo: {
        price: number;
        supplyAmount: number;
        mktCap: number;
    };
}

const scanToken = async (contractAddress: string): Promise<FilteredTokenResponse | null> => {
    try {
        const res = await axios.get<tokenDetails>(`${base_url}/token/${contractAddress}`, {
            headers: {
                'X-API-KEY': api_key,
                'Content-Type': 'application/json',
            },
        });

        const { address, tokenName, tokenSymbol, auditRisk, score } = res.data.tokenData;
        const { price, supplyAmount, mktCap } = res.data.tokenInfo;

        const filteredResponse: FilteredTokenResponse = {
            address,
            tokenName,
            tokenSymbol,
            score,
            auditRisk,
            tokenInfo: { price, supplyAmount: Math.round(supplyAmount), mktCap: Math.round(mktCap) }, // Include tokenInfo with price details
        };

        console.log('Filtered Token Response:', filteredResponse);

        return filteredResponse;
    } catch (error) {
        console.error('Error fetching data:', error);
        return null;
    }
};

// Call the function
// scanToken('2J5Dpp57RsjLBkJrEvyrAQpg8qWvgadUeJR4Ln7bpump');

export default scanToken