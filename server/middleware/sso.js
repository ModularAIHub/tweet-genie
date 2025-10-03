// SSO middleware for authenticating users from main platform
import jwt from 'jsonwebtoken';

export const validateSSOToken = (req, res, next) => {
    try {
        const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
        
        if (!token) {
            return res.status(401).json({ error: 'SSO token required' });
        }
        
        // Verify the token with the same secret as main platform
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        
        // Validate token audience includes this subdomain
        if (!decoded.aud || !decoded.aud.includes('tweetgenie')) {
            return res.status(403).json({ error: 'Token not valid for this subdomain' });
        }
        
        // Validate token issuer
        if (decoded.iss !== 'main-platform') {
            return res.status(403).json({ error: 'Invalid token issuer' });
        }
        
        // Add user context to request
        req.ssoUser = {
            userId: decoded.userId,
            teamId: decoded.teamId,
            role: decoded.role,
            email: decoded.email,
            name: decoded.name,
            teamName: decoded.teamName
        };
        
        next();
    } catch (error) {
        console.error('SSO token validation error:', error);
        
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'SSO token expired' });
        }
        
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ error: 'Invalid SSO token' });
        }
        
        return res.status(500).json({ error: 'SSO authentication failed' });
    }
};

// Optional: Extract token info without validation (for logout, etc.)
export const extractSSOToken = (req, res, next) => {
    try {
        const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
        
        if (token) {
            // Decode without verification (just to get info)
            const decoded = jwt.decode(token);
            req.tokenInfo = decoded;
        }
        
        next();
    } catch (error) {
        // Continue without token info if extraction fails
        next();
    }
};