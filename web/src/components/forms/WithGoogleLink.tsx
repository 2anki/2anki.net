import styles from '../../styles/auth.module.css';

interface WithGoogleLinkProps {
  text: string;
  variant?: 'row' | 'card';
  onSelect?: () => void;
}

export function WithGoogleLink({
  text,
  variant = 'row',
  onSelect,
}: Readonly<WithGoogleLinkProps>) {
  const isCard = variant === 'card';
  return (
    <a
      href="/api/users/auth/google/init"
      className={isCard ? styles.oauthCard : styles.googleButton}
      aria-label={isCard ? text : undefined}
      onClick={onSelect}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 48 48"
        width="20px"
        height="20px"
        aria-hidden="true"
      >
        <path
          fill="#4285F4"
          d="M47.532 24.5523c0-1.6418-.1471-3.2207-.4205-4.7367H24.48v8.9596h12.9408c-.5577 3.0058-2.2533 5.5495-4.8054 7.2562v6.0316h7.7758c4.5471-4.1855 7.1717-10.3489 7.1717-17.5107z"
        />
        <path
          fill="#34A853"
          d="M24.48 48c6.4632 0 11.8788-2.1431 15.8388-5.7895l-7.7758-6.0316c-2.1538 1.4421-4.9085 2.2925-8.063 2.2925-6.2168 0-11.4795-4.1855-13.3565-9.8275H3.0428v6.2353C7.0028 42.6075 15.1393 48 24.48 48z"
        />
        <path
          fill="#FBBC05"
          d="M11.1235 28.6438c-.4855-1.4421-.7593-2.9842-.7593-4.6438s.2738-3.2017.7593-4.6438v-6.2353H3.0428C1.0628 17.1207 0 20.4225 0 24c0 3.5775 1.0628 6.8793 3.0428 9.8793l8.0807-5.2355z"
        />
        <path
          fill="#EA4335"
          d="M24.48 9.5288c3.5147 0 6.6628 1.2095 9.1495 3.5772l6.8638-6.8638C36.355 2.3924 30.9437 0 24.48 0 15.1393 0 7.0028 5.3925 3.0428 13.2807l8.0807 6.2353c1.877-5.642 7.1397-9.9872 13.3565-9.9872z"
        />
      </svg>
      <span>{isCard ? 'Google' : text}</span>
    </a>
  );
}
