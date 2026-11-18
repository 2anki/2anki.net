import { withSignInReturn } from '../../lib/auth/withSignInReturn';
import { getAppleSignInUrl } from '../../lib/backend/getAppleSignInUrl';
import styles from '../../styles/auth.module.css';

interface WithAppleLinkProps {
  text: string;
  variant?: 'row' | 'card';
  onSelect?: () => void;
  redirect?: string | null;
}

export function WithAppleLink({
  text,
  variant = 'row',
  onSelect,
  redirect,
}: Readonly<WithAppleLinkProps>) {
  const isCard = variant === 'card';
  return (
    <a
      href={withSignInReturn(getAppleSignInUrl(), redirect)}
      className={isCard ? styles.appleCard : styles.appleButton}
      aria-label={isCard ? text : undefined}
      onClick={onSelect}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        width="20px"
        height="20px"
        aria-hidden="true"
        fill="currentColor"
      >
        <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
      </svg>
      <span>{isCard ? 'Apple' : text}</span>
    </a>
  );
}
