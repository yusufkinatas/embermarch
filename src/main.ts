import './styles/theme.css';
import { createApp } from './app/app';
import { installPwa } from './pwa';

installPwa();

let root = document.getElementById('app');
if (!root) {
  root = document.createElement('div');
  root.id = 'app';
  document.body.appendChild(root);
}
createApp(root);
