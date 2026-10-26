import React from 'react';
import { styles } from './styles';

export const DownloadFooter: React.FC = () => {
  return (
    <footer style={styles.footer}>
      <a
        href="https://2anki.net"
        style={styles.footerLink}
        target="_blank"
        rel="noopener noreferrer"
      >
        2anki.net
      </a>
      {' · '}
      <a
        href="https://2anki.net/documentation/"
        style={styles.footerLink}
        target="_blank"
        rel="noopener noreferrer"
      >
        Documentation
      </a>
      {' · '}
      <a
        href="https://github.com/2anki/2anki.net"
        style={styles.footerLink}
        target="_blank"
        rel="noopener noreferrer"
      >
        GitHub
      </a>
    </footer>
  );
};
