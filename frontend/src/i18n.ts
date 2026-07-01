import type { Language } from './types'

export const translations = {
  fr: {
    loading: 'Chargement d’Atlas SI…',
    loginEyebrow: 'Cartographie du système d’information',
    loginIntro: 'Référentiel central des processus, applications, infrastructures, données et dépendances.',
    loginButton: 'Se connecter avec Keycloak',
    localLoginButton: 'Se connecter',
    username: 'Identifiant',
    password: 'Mot de passe',
    localAuthentication: 'Authentification locale',
    dashboard: 'Vue d’ensemble', map: 'Cartographie', savedMaps: 'Cartes enregistrées', analysis: 'Analyse d’impact', versions: 'Versions et obsolescence',
    objects: 'Objets du SI', relations: 'Relations', imports: 'Imports', administration: 'Administration', objectTypes: 'Types d’objets', relationTypes: 'Types de relations',
    design: 'Design et langue', quality: 'Qualité et audit', audit: 'Historique', logout: 'Se déconnecter',
    welcome: 'Bienvenue', dashboardSubtitle: 'La cartographie interactive est opérationnelle.',
    lot6: 'Version finale', dashboardTitle: 'Pilote la qualité, les dépendances et l’obsolescence du système d’information',
    language: 'Langue', french: 'Français', english: 'Anglais'
  },
  en: {
    loading: 'Loading Atlas SI…',
    loginEyebrow: 'Information system mapping',
    loginIntro: 'Central repository for processes, applications, infrastructure, data and dependencies.',
    loginButton: 'Sign in with Keycloak',
    localLoginButton: 'Sign in',
    username: 'Username',
    password: 'Password',
    localAuthentication: 'Local authentication',
    dashboard: 'Overview', map: 'Map', savedMaps: 'Saved maps', analysis: 'Impact analysis', versions: 'Versions and obsolescence',
    objects: 'IS objects', relations: 'Relationships', imports: 'Imports', administration: 'Administration', objectTypes: 'Object types', relationTypes: 'Relationship types',
    design: 'Design and language', quality: 'Quality and audit', audit: 'History', logout: 'Sign out',
    welcome: 'Welcome', dashboardSubtitle: 'The interactive mapping service is operational.',
    lot6: 'Final release', dashboardTitle: 'Manage information system quality, dependencies and obsolescence',
    language: 'Language', french: 'French', english: 'English'
  }
} as const

export type TranslationKey = keyof typeof translations.fr
export function tr(language: Language, key: TranslationKey): string {
  return translations[language][key] ?? translations.fr[key]
}
