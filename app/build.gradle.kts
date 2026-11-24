plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "fr.velospeed"
    compileSdk = 34

    defaultConfig {
        applicationId = "fr.velospeed.a13"
        minSdk = 23          // Android 6.0
        targetSdk = 34       // Android 14 (fonctionne aussi sur Android 15)
        versionCode = 3
        versionName = "2.0.1"
    }

    // Clé de signature fixe, propre à ce projet personnel : elle permet de mettre à jour l'appli
    // par-dessus une version précédente sans désinstaller. Ce n'est pas une clé de publication.
    signingConfigs {
        create("velo") {
            storeFile = file("velo-debug.jks")
            storePassword = "velospeed"
            keyAlias = "velo"
            keyPassword = "velospeed"
        }
    }

    buildTypes {
        getByName("debug") {
            signingConfig = signingConfigs.getByName("velo")
        }
        getByName("release") {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("velo")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}
