import '@iternio/react-native-auto-play/installTimers';
import { registerRootComponent } from 'expo';

import App from './App';
import { registerAutoPlaySample } from './src/car/AutoPlaySample';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
registerAutoPlaySample();
