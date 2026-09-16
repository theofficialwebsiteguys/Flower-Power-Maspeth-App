import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // Matches android/app/build.gradle's applicationId and google-services.json's
  // package_name — the previous value here ('com.flowerpowerdispensers.application')
  // didn't match either, which would have broken `cap sync`/FCM wiring.
  appId: 'com.flowerpower.app',
  appName: 'Flower Power Maspeth',
  webDir: 'www',
  server: {
    hostname: "com.flowerpower.app",
    androidScheme: "https",
    allowNavigation: ["pay.aero.inc"]
  },
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
    SplashScreen: {
      launchShowDuration: 0, // Disables Capacitor's default splash screen to use custom Angular component
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"]
    },
    FirebaseMessaging: {
      presentationOptions: ["badge", "sound", "alert"]
    },
    DeepLinks: {
      schemes: ["flowerPower"],
      hosts: ["dispensary-api-ac9613fa4c11.herokuapp.com"]
    }
  },
};

export default config;
