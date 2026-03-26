# AWS SNS Permissions Required

To send real SMS messages, your AWS IAM user needs SNS permissions.

## Required IAM Policy

Add this policy to your IAM user `ALERTS3BUCKET`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "sns:Publish"
      ],
      "Resource": "*"
    }
  ]
}
```

## How to Add Permissions (AWS Console)

1. Go to **AWS IAM Console**: https://console.aws.amazon.com/iam/
2. Click **Users** → Select user `ALERTS3BUCKET`
3. Click **Add permissions** → **Attach policies directly**
4. Search for and select: **AmazonSNSFullAccess** (AWS managed policy)
5. Click **Next** → **Add permissions**

## ⚠️ IMPORTANT: AWS SNS Sandbox Mode

**AWS SNS SMS starts in SANDBOX MODE** - you can only send SMS to verified phone numbers!

### To verify phone numbers (required in sandbox):

1. Go to **AWS SNS Console**: https://console.aws.amazon.com/sns/
2. Click **Text messaging (SMS)** in left menu
3. Scroll down to **Sandbox destination phone numbers**
4. Click **Add phone number**
5. Enter phone number in international format: `+919717572728`
6. AWS will send a verification code to that number
7. Enter the code to verify

### To move out of sandbox (for production):

1. Go to **SNS Console** → **Text messaging (SMS)**
2. Click **Request production access** or **Exit sandbox**
3. Fill out the request form
4. AWS typically approves within 24 hours

## SMS Spending Limits

⚠️ **Important**: AWS SNS has default spending limits for SMS:
- **Default limit**: $1.00 USD per month
- To increase: Go to **SNS Console** → **Text messaging (SMS)** → **Account spend limit** → Request increase

## Verify Your Setup

### Check if you're in sandbox mode:

1. Go to **SNS Console**: https://ap-south-1.console.aws.amazon.com/sns/
2. Click **Text messaging (SMS)**
3. Check the **Sandbox status** section
4. If it says "Sandbox", you must verify phone numbers first

### Common Issues:

1. **SMS not received but API shows success**
   - You're in sandbox mode and the phone number is not verified
   - Solution: Verify the phone number in SNS console

2. **MessageId returned but no SMS**
   - Phone number might be in DND (Do Not Disturb) registry
   - Carrier blocking promotional SMS
   - Solution: Use "Transactional" SMS type (already configured)

3. **SMS delayed**
   - Normal in some regions, can take 1-5 minutes
   - Check your phone's blocked messages

## Test After Setup

Once permissions are added AND phone number is verified:

```bash
curl --location 'http://localhost:4100/api/v1/auth/phone/request-verification' \
--header 'Content-Type: application/json' \
--data '{"username": "sonu"}'
```

Check the logs for `message_id` - if present, SMS was sent successfully!
