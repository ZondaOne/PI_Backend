import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET;

/**
 * Generate a secure random token for magic links
 * @returns {string} 64-character hex token
 */
export function generateMagicToken() {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Generate JWT for authenticated user
 * @param {Object} user - User object with id, email, isPremium
 * @returns {string} JWT token
 */
export function generateJWT(user) {
    return jwt.sign(
        {
            id: user.id,
            email: user.email,
            isPremium: user.isPremium,
        },
        JWT_SECRET,
        { expiresIn: '30d' }
    );
}

/**
 * Verify and decode JWT
 * @param {string} token - JWT token
 * @returns {Object|null} Decoded payload or null if invalid
 */
export function verifyJWT(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (err) {
        return null;
    }
}

/**
 * Express middleware for protected routes
 */
export function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Authorization required' });
    }

    const token = authHeader.substring(7);
    const decoded = verifyJWT(token);

    if (!decoded) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    req.user = decoded;
    next();
}
