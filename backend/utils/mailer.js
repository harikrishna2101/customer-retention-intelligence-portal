const nodemailer = require('nodemailer');

// Safety check — warn early if env vars are missing
if (!process.env.EMAIL_USER || !process.env.EMAIL_APP_PASSWORD) {
    console.error('[MAILER] WARNING: EMAIL_USER or EMAIL_APP_PASSWORD is not set in .env');
}

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_APP_PASSWORD,
    },
});

// Verify transporter connection on startup
transporter.verify((err, success) => {
    if (err) {
        console.error('[MAILER] Gmail connection FAILED:', err.code, '-', err.message);
    } else {
        console.log('[MAILER] Gmail connection verified. Ready to send emails.');
    }
});

const sendOTP = async (toEmail, otpCode) => {
    try {
        const mailOptions = {
            from: `"CRIP Platform" <${process.env.EMAIL_USER}>`,
            to: toEmail,
            subject: 'Your CRIP Verification Code',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #ddd; padding: 20px; border-radius: 8px;">
                    <h2 style="color: #333;">Authentication Required</h2>
                    <p style="color: #555; font-size: 16px;">
                        You recently requested to access the Customer Retention Intelligence Portal (CRIP).
                        Here is your secure, one-time verification code:
                    </p>
                    <div style="background-color: #f4f4f4; padding: 15px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 10px; margin: 20px 0; border-radius: 5px; color: #222;">
                        ${otpCode}
                    </div>
                    <p style="color: #777; font-size: 14px;">
                        This code will expire in <strong>10 minutes</strong>. If you did not request this, please ignore this email.
                    </p>
                    <hr style="border: 0; border-top: 1px solid #eee; margin: 30px 0;" />
                    <p style="color: #999; font-size: 12px; text-align: center;">
                        &copy; ${new Date().getFullYear()} CRIP Platform. All rights reserved.
                    </p>
                </div>
            `,
        };

        const info = await transporter.sendMail(mailOptions);
        console.log(`[MAILER] OTP sent successfully to ${toEmail} | MessageID: ${info.messageId}`);
        return true;

    } catch (err) {
        // Full error details so you can diagnose exactly what went wrong
        console.error(`[MAILER] FAILED to send email to ${toEmail}`);
        console.error(`[MAILER] Error Code   : ${err.code}`);
        console.error(`[MAILER] Error Message: ${err.message}`);
        console.error(`[MAILER] SMTP Response: ${err.response || 'N/A'}`);
        return false;
    }
};

module.exports = { sendOTP };