import os
import sys
import smtplib
import traceback

from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

ERROR_SENDER_EMAIL = os.getenv('ERROR_SENDER_EMAIL', 'noreply@2anki.net')
ERROR_RECEIVER_EMAIL = os.getenv('ERROR_RECEIVER_EMAIL', 'alexander@alemayhu.com')

def operator_error_report(label, error):
    """
    Build the subject and body of an operator error email that leaves out
    anything the user supplied. An exception message or a traceback's last line
    can name the user's files or cards, so the report carries only the error
    kind, the frames (file, line and function in our code) and the request or
    job reference the server passed in TWOANKI_REQUEST_ID.

    Args:
        label (str): which script failed, e.g. "IO deck"
        error (BaseException): the error being reported

    Returns:
        tuple[str, str]: the subject line and the body
    """
    kind = type(error).__name__
    reference = os.getenv('TWOANKI_REQUEST_ID') or 'unknown'
    frames = traceback.extract_tb(error.__traceback__)
    where = '\n'.join(
        f"  {os.path.basename(frame.filename)}:{frame.lineno} in {frame.name}"
        for frame in frames
    ) or '  (no frames)'
    subject = f"[ERROR] [2anki.net] {label} - {kind}"
    body = f"""
Error kind: {kind}
Reference: {reference}
Frames:
{where}
"""
    return subject, body


def send_error_email(subject, error_message):
    """
    Send an error email with the given subject and message.
    
    Args:
        subject (str): The subject line of the email
        error_message (str): The error details to include in the email body
    """
    msg = MIMEMultipart()
    msg['From'] = ERROR_SENDER_EMAIL
    msg['To'] = ERROR_RECEIVER_EMAIL
    msg['Subject'] = subject
    msg.attach(MIMEText(error_message, 'plain'))

    try:
        with smtplib.SMTP('localhost') as server:
            server.send_message(msg)
    except smtplib.SMTPException as email_err:
        print(f"Failed to send error email: {email_err}", file=sys.stderr)