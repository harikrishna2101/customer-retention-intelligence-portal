const fs = require('fs');
const jwt = require('jsonwebtoken');

/**
 * Shared authentication middleware — DRY principle.
 * Verifies JWT from cookie and attaches user to request.
 */
const protect = (req, res, next) => {
    const token = req.cookies['crip-token'];
    if (!token) return res.status(401).json({ success: false, message: 'Not authorized' });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ success: false, message: 'Token failed verification' });
    }
};

/**
 * Safely delete a temporary file with retry logic.
 * @param {string} filePath - Path to the file to delete
 * @param {string} label - Human-readable label for logging
 */
async function cleanupTempFile(filePath, label = 'temporary file') {
    if (!filePath) return;

    for (let attempt = 1; attempt <= 10; attempt++) {
        try {
            await fs.promises.unlink(filePath);
            return;
        } catch (err) {
            if (err.code === 'ENOENT') return;
            if (attempt === 10) {
                console.warn(`[UTIL] Could not remove ${label} ${filePath}: ${err.message}`);
                return;
            }
            await new Promise(resolve => setTimeout(resolve, attempt * 250));
        }
    }
}

/**
 * HTML escaper for server-side rendering safety.
 */
function escapeHtml(string) {
    const htmlEntities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return String(string).replace(/[&<>"']/g, char => htmlEntities[char]);
}

module.exports = { protect, cleanupTempFile, escapeHtml };
