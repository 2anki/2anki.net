import styles from '../../styles/auth.module.css';

interface WithMicrosoftLinkProps {
  text: string;
  variant?: 'row' | 'card';
  onSelect?: () => void;
}

export function WithMicrosoftLink({
  text,
  variant = 'row',
  onSelect,
}: Readonly<WithMicrosoftLinkProps>) {
  const isCard = variant === 'card';
  return (
    <a
      href="/api/users/auth/microsoft/init"
      className={isCard ? styles.oauthCard : styles.microsoftButton}
      aria-label={isCard ? text : undefined}
      onClick={onSelect}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 21 21"
        width="20px"
        height="20px"
        aria-hidden="true"
      >
        <rect x="0" y="0" width="10" height="10" fill="#F25022" />
        <rect x="11" y="0" width="10" height="10" fill="#7FBA00" />
        <rect x="0" y="11" width="10" height="10" fill="#00A4EF" />
        <rect x="11" y="11" width="10" height="10" fill="#FFB900" />
      </svg>
      <span>{isCard ? 'Microsoft' : text}</span>
    </a>
  );
}
