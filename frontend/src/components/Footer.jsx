import styles from './Footer.module.css'

export default function Footer() {
  const year = new Date().getFullYear()
  return (
    <footer className={styles.footer}>
      <span>© {year} PocketScrum - Tous droits réservés</span>
    </footer>
  )
}
