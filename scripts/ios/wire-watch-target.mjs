/**
 * Idempotently wire the ParkBoundWatch watchOS target into App.xcodeproj.
 * Safe to re-run. Does not require Xcode — validates structure on any OS.
 *
 *   node scripts/ios/wire-watch-target.mjs
 *   node scripts/ios/wire-watch-target.mjs --check
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const PBX = path.join(ROOT, 'ios/App/App.xcodeproj/project.pbxproj');
const MARKER = 'ParkBoundWatch';

const checkOnly = process.argv.includes('--check');

const ids = {
  product: 'A7WATCH00000000000000001',
  target: 'A7WATCH00000000000000002',
  sources: 'A7WATCH00000000000000003',
  resources: 'A7WATCH00000000000000004',
  frameworks: 'A7WATCH00000000000000005',
  group: 'A7WATCH00000000000000006',
  appSwift: 'A7WATCH00000000000000007',
  compassSwift: 'A7WATCH00000000000000008',
  sessionSwift: 'A7WATCH00000000000000009',
  infoPlist: 'A7WATCH0000000000000000A',
  assets: 'A7WATCH0000000000000000B',
  entitlements: 'A7WATCH0000000000000000C',
  buildApp: 'A7WATCH0000000000000000D',
  buildCompass: 'A7WATCH0000000000000000E',
  buildSession: 'A7WATCH0000000000000000F',
  buildAssets: 'A7WATCH00000000000000010',
  cfgDebug: 'A7WATCH00000000000000011',
  cfgRelease: 'A7WATCH00000000000000012',
  cfgList: 'A7WATCH00000000000000013',
  embedPhase: 'A7WATCH00000000000000014',
  embedFile: 'A7WATCH00000000000000015',
  proxy: 'A7WATCH00000000000000016',
  dependency: 'A7WATCH00000000000000017',
  phoneSession: 'A7WATCH00000000000000018',
  phonePlugin: 'A7WATCH00000000000000019',
  buildPhoneSession: 'A7WATCH0000000000000001A',
  buildPhonePlugin: 'A7WATCH0000000000000001B',
};

function requiredWatchFiles() {
  const base = path.join(ROOT, 'ios/App/ParkBoundWatch');
  return [
    'ParkBoundWatchApp.swift',
    'WatchCompass.swift',
    'WatchCompassSession.swift',
    'Info.plist',
    'ParkBoundWatch.entitlements',
    'Assets.xcassets/Contents.json',
  ].map((f) => path.join(base, f));
}

function assertWatchSources() {
  const missing = requiredWatchFiles().filter((f) => !fs.existsSync(f));
  if (missing.length) {
    throw new Error(`Missing Watch sources:\n${missing.join('\n')}`);
  }
  const phone = [
    path.join(ROOT, 'ios/App/App/WatchCompassPhoneSession.swift'),
    path.join(ROOT, 'ios/App/App/WatchCompassPlugin.swift'),
  ];
  const missPhone = phone.filter((f) => !fs.existsSync(f));
  if (missPhone.length) {
    throw new Error(`Missing phone bridge sources:\n${missPhone.join('\n')}`);
  }
}

function alreadyWired(text) {
  return text.includes(MARKER) && text.includes(ids.target) && text.includes('WatchCompassPlugin.swift');
}

function wire(text) {
  if (alreadyWired(text)) return { text, changed: false };

  let next = text;

  // PBXBuildFile
  next = next.replace(
    '/* End PBXBuildFile section */',
    `\t\t${ids.buildApp} /* ParkBoundWatchApp.swift in Sources */ = {isa = PBXBuildFile; fileRef = ${ids.appSwift} /* ParkBoundWatchApp.swift */; };
\t\t${ids.buildCompass} /* WatchCompass.swift in Sources */ = {isa = PBXBuildFile; fileRef = ${ids.compassSwift} /* WatchCompass.swift */; };
\t\t${ids.buildSession} /* WatchCompassSession.swift in Sources */ = {isa = PBXBuildFile; fileRef = ${ids.sessionSwift} /* WatchCompassSession.swift */; };
\t\t${ids.buildAssets} /* Assets.xcassets in Resources */ = {isa = PBXBuildFile; fileRef = ${ids.assets} /* Assets.xcassets */; };
\t\t${ids.embedFile} /* ParkBoundWatch.app in Embed Watch Content */ = {isa = PBXBuildFile; fileRef = ${ids.product} /* ParkBoundWatch.app */; settings = {ATTRIBUTES = (RemoveHeadersOnCopy, ); }; };
\t\t${ids.buildPhoneSession} /* WatchCompassPhoneSession.swift in Sources */ = {isa = PBXBuildFile; fileRef = ${ids.phoneSession} /* WatchCompassPhoneSession.swift */; };
\t\t${ids.buildPhonePlugin} /* WatchCompassPlugin.swift in Sources */ = {isa = PBXBuildFile; fileRef = ${ids.phonePlugin} /* WatchCompassPlugin.swift */; };
/* End PBXBuildFile section */`,
  );

  // PBXFileReference
  next = next.replace(
    '/* End PBXFileReference section */',
    `\t\t${ids.product} /* ParkBoundWatch.app */ = {isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = ParkBoundWatch.app; sourceTree = BUILT_PRODUCTS_DIR; };
\t\t${ids.appSwift} /* ParkBoundWatchApp.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = ParkBoundWatchApp.swift; sourceTree = "<group>"; };
\t\t${ids.compassSwift} /* WatchCompass.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = WatchCompass.swift; sourceTree = "<group>"; };
\t\t${ids.sessionSwift} /* WatchCompassSession.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = WatchCompassSession.swift; sourceTree = "<group>"; };
\t\t${ids.infoPlist} /* Info.plist */ = {isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = Info.plist; sourceTree = "<group>"; };
\t\t${ids.assets} /* Assets.xcassets */ = {isa = PBXFileReference; lastKnownFileType = folder.assetcatalog; path = Assets.xcassets; sourceTree = "<group>"; };
\t\t${ids.entitlements} /* ParkBoundWatch.entitlements */ = {isa = PBXFileReference; lastKnownFileType = text.plist.entitlements; path = ParkBoundWatch.entitlements; sourceTree = "<group>"; };
\t\t${ids.phoneSession} /* WatchCompassPhoneSession.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = WatchCompassPhoneSession.swift; sourceTree = "<group>"; };
\t\t${ids.phonePlugin} /* WatchCompassPlugin.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = WatchCompassPlugin.swift; sourceTree = "<group>"; };
/* End PBXFileReference section */`,
  );

  // Frameworks phase for Watch
  next = next.replace(
    '/* End PBXFrameworksBuildPhase section */',
    `\t\t${ids.frameworks} /* Frameworks */ = {
\t\t\tisa = PBXFrameworksBuildPhase;
\t\t\tbuildActionMask = 2147483647;
\t\t\tfiles = (
\t\t\t);
\t\t\trunOnlyForDeploymentPostprocessing = 0;
\t\t};
/* End PBXFrameworksBuildPhase section */`,
  );

  // Groups — root children + products + App sources + Watch group
  next = next.replace(
    `children = (
\t\t\t\t504EC3061FED79650016851F /* App */,
\t\t\t\t504EC3051FED79650016851F /* Products */,
\t\t\t\t7F8756D8B27F46E3366F6CEA /* Pods */,
\t\t\t\t27E2DDA53C4D2A4D1A88CE4A /* Frameworks */,
\t\t\t);`,
    `children = (
\t\t\t\t504EC3061FED79650016851F /* App */,
\t\t\t\t${ids.group} /* ParkBoundWatch */,
\t\t\t\t504EC3051FED79650016851F /* Products */,
\t\t\t\t7F8756D8B27F46E3366F6CEA /* Pods */,
\t\t\t\t27E2DDA53C4D2A4D1A88CE4A /* Frameworks */,
\t\t\t);`,
  );

  next = next.replace(
    `children = (
\t\t\t\t504EC3041FED79650016851F /* App.app */,
\t\t\t);`,
    `children = (
\t\t\t\t504EC3041FED79650016851F /* App.app */,
\t\t\t\t${ids.product} /* ParkBoundWatch.app */,
\t\t\t);`,
  );

  next = next.replace(
    `504EC3071FED79650016851F /* AppDelegate.swift */,`,
    `504EC3071FED79650016851F /* AppDelegate.swift */,
\t\t\t\t${ids.phoneSession} /* WatchCompassPhoneSession.swift */,
\t\t\t\t${ids.phonePlugin} /* WatchCompassPlugin.swift */,`,
  );

  next = next.replace(
    '/* End PBXGroup section */',
    `\t\t${ids.group} /* ParkBoundWatch */ = {
\t\t\tisa = PBXGroup;
\t\t\tchildren = (
\t\t\t\t${ids.appSwift} /* ParkBoundWatchApp.swift */,
\t\t\t\t${ids.compassSwift} /* WatchCompass.swift */,
\t\t\t\t${ids.sessionSwift} /* WatchCompassSession.swift */,
\t\t\t\t${ids.infoPlist} /* Info.plist */,
\t\t\t\t${ids.entitlements} /* ParkBoundWatch.entitlements */,
\t\t\t\t${ids.assets} /* Assets.xcassets */,
\t\t\t);
\t\t\tpath = ParkBoundWatch;
\t\t\tsourceTree = "<group>";
\t\t};
/* End PBXGroup section */`,
  );

  // Native target + embed dependency on App
  next = next.replace(
    '/* End PBXNativeTarget section */',
    `\t\t${ids.target} /* ParkBoundWatch */ = {
\t\t\tisa = PBXNativeTarget;
\t\t\tbuildConfigurationList = ${ids.cfgList} /* Build configuration list for PBXNativeTarget "ParkBoundWatch" */;
\t\t\tbuildPhases = (
\t\t\t\t${ids.sources} /* Sources */,
\t\t\t\t${ids.frameworks} /* Frameworks */,
\t\t\t\t${ids.resources} /* Resources */,
\t\t\t);
\t\t\tbuildRules = (
\t\t\t);
\t\t\tdependencies = (
\t\t\t);
\t\t\tname = ParkBoundWatch;
\t\t\tproductName = ParkBoundWatch;
\t\t\tproductReference = ${ids.product} /* ParkBoundWatch.app */;
\t\t\tproductType = "com.apple.product-type.application";
\t\t};
/* End PBXNativeTarget section */`,
  );

  next = next.replace(
    `buildPhases = (
\t\t\t\t6634F4EFEBD30273BCE97C65 /* [CP] Check Pods Manifest.lock */,
\t\t\t\t504EC3001FED79650016851F /* Sources */,
\t\t\t\t504EC3011FED79650016851F /* Frameworks */,
\t\t\t\t504EC3021FED79650016851F /* Resources */,
\t\t\t\t9592DBEFFC6D2A0C8D5DEB22 /* [CP] Embed Pods Frameworks */,
\t\t\t);
\t\t\tbuildRules = (
\t\t\t);
\t\t\tdependencies = (
\t\t\t);
\t\t\tname = App;`,
    `buildPhases = (
\t\t\t\t6634F4EFEBD30273BCE97C65 /* [CP] Check Pods Manifest.lock */,
\t\t\t\t504EC3001FED79650016851F /* Sources */,
\t\t\t\t504EC3011FED79650016851F /* Frameworks */,
\t\t\t\t504EC3021FED79650016851F /* Resources */,
\t\t\t\t9592DBEFFC6D2A0C8D5DEB22 /* [CP] Embed Pods Frameworks */,
\t\t\t\t${ids.embedPhase} /* Embed Watch Content */,
\t\t\t);
\t\t\tbuildRules = (
\t\t\t);
\t\t\tdependencies = (
\t\t\t\t${ids.dependency} /* PBXTargetDependency */,
\t\t\t);
\t\t\tname = App;`,
  );

  // Project attributes + targets list
  next = next.replace(
    `TargetAttributes = {
\t\t\t\t\t504EC3031FED79650016851F = {
\t\t\t\t\t\tCreatedOnToolsVersion = 9.2;
\t\t\t\t\t\tLastSwiftMigration = 1100;
\t\t\t\t\t\tProvisioningStyle = Automatic;
\t\t\t\t\t};
\t\t\t\t};`,
    `TargetAttributes = {
\t\t\t\t\t504EC3031FED79650016851F = {
\t\t\t\t\t\tCreatedOnToolsVersion = 9.2;
\t\t\t\t\t\tLastSwiftMigration = 1100;
\t\t\t\t\t\tProvisioningStyle = Automatic;
\t\t\t\t\t};
\t\t\t\t\t${ids.target} = {
\t\t\t\t\t\tCreatedOnToolsVersion = 15.0;
\t\t\t\t\t\tProvisioningStyle = Automatic;
\t\t\t\t\t};
\t\t\t\t};`,
  );

  next = next.replace(
    `targets = (
\t\t\t\t504EC3031FED79650016851F /* App */,
\t\t\t);`,
    `targets = (
\t\t\t\t504EC3031FED79650016851F /* App */,
\t\t\t\t${ids.target} /* ParkBoundWatch */,
\t\t\t);`,
  );

  // Copy files + container proxy + dependency
  next = next.replace(
    '/* Begin PBXResourcesBuildPhase section */',
    `/* Begin PBXCopyFilesBuildPhase section */
\t\t${ids.embedPhase} /* Embed Watch Content */ = {
\t\t\tisa = PBXCopyFilesBuildPhase;
\t\t\tbuildActionMask = 2147483647;
\t\t\tdstPath = "$(CONTENTS_FOLDER_PATH)/Watch";
\t\t\tdstSubfolderSpec = 16;
\t\t\tfiles = (
\t\t\t\t${ids.embedFile} /* ParkBoundWatch.app in Embed Watch Content */,
\t\t\t);
\t\t\tname = "Embed Watch Content";
\t\t\trunOnlyForDeploymentPostprocessing = 0;
\t\t};
/* End PBXCopyFilesBuildPhase section */

/* Begin PBXContainerItemProxy section */
\t\t${ids.proxy} /* PBXContainerItemProxy */ = {
\t\t\tisa = PBXContainerItemProxy;
\t\t\tcontainerPortal = 504EC2FC1FED79650016851F /* Project object */;
\t\t\tproxyType = 1;
\t\t\tremoteGlobalIDString = ${ids.target};
\t\t\tremoteInfo = ParkBoundWatch;
\t\t};
/* End PBXContainerItemProxy section */

/* Begin PBXTargetDependency section */
\t\t${ids.dependency} /* PBXTargetDependency */ = {
\t\t\tisa = PBXTargetDependency;
\t\t\ttarget = ${ids.target} /* ParkBoundWatch */;
\t\t\ttargetProxy = ${ids.proxy} /* PBXContainerItemProxy */;
\t\t};
/* End PBXTargetDependency section */

/* Begin PBXResourcesBuildPhase section */`,
  );

  next = next.replace(
    '/* End PBXResourcesBuildPhase section */',
    `\t\t${ids.resources} /* Resources */ = {
\t\t\tisa = PBXResourcesBuildPhase;
\t\t\tbuildActionMask = 2147483647;
\t\t\tfiles = (
\t\t\t\t${ids.buildAssets} /* Assets.xcassets in Resources */,
\t\t\t);
\t\t\trunOnlyForDeploymentPostprocessing = 0;
\t\t};
/* End PBXResourcesBuildPhase section */`,
  );

  next = next.replace(
    `files = (
\t\t\t\t504EC3081FED79650016851F /* AppDelegate.swift in Sources */,
\t\t\t);`,
    `files = (
\t\t\t\t504EC3081FED79650016851F /* AppDelegate.swift in Sources */,
\t\t\t\t${ids.buildPhoneSession} /* WatchCompassPhoneSession.swift in Sources */,
\t\t\t\t${ids.buildPhonePlugin} /* WatchCompassPlugin.swift in Sources */,
\t\t\t);`,
  );

  next = next.replace(
    '/* End PBXSourcesBuildPhase section */',
    `\t\t${ids.sources} /* Sources */ = {
\t\t\tisa = PBXSourcesBuildPhase;
\t\t\tbuildActionMask = 2147483647;
\t\t\tfiles = (
\t\t\t\t${ids.buildApp} /* ParkBoundWatchApp.swift in Sources */,
\t\t\t\t${ids.buildCompass} /* WatchCompass.swift in Sources */,
\t\t\t\t${ids.buildSession} /* WatchCompassSession.swift in Sources */,
\t\t\t);
\t\t\trunOnlyForDeploymentPostprocessing = 0;
\t\t};
/* End PBXSourcesBuildPhase section */`,
  );

  // Build configurations for Watch
  next = next.replace(
    '/* End XCBuildConfiguration section */',
    `\t\t${ids.cfgDebug} /* Debug */ = {
\t\t\tisa = XCBuildConfiguration;
\t\t\tbuildSettings = {
\t\t\t\tASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;
\t\t\t\tCODE_SIGN_ENTITLEMENTS = ParkBoundWatch/ParkBoundWatch.entitlements;
\t\t\t\tCODE_SIGN_STYLE = Automatic;
\t\t\t\tCURRENT_PROJECT_VERSION = 1;
\t\t\t\tGENERATE_INFOPLIST_FILE = NO;
\t\t\t\tINFOPLIST_FILE = ParkBoundWatch/Info.plist;
\t\t\t\tLD_RUNPATH_SEARCH_PATHS = "$(inherited) @executable_path/Frameworks";
\t\t\t\tMARKETING_VERSION = 1.8.0;
\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = ai.kurat0r.parkbound.watchkitapp;
\t\t\t\tPRODUCT_NAME = "$(TARGET_NAME)";
\t\t\t\tSDKROOT = watchos;
\t\t\t\tSKIP_INSTALL = YES;
\t\t\t\tSWIFT_VERSION = 5.0;
\t\t\t\tTARGETED_DEVICE_FAMILY = 4;
\t\t\t\tWATCHOS_DEPLOYMENT_TARGET = 10.0;
\t\t\t};
\t\t\tname = Debug;
\t\t};
\t\t${ids.cfgRelease} /* Release */ = {
\t\t\tisa = XCBuildConfiguration;
\t\t\tbuildSettings = {
\t\t\t\tASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;
\t\t\t\tCODE_SIGN_ENTITLEMENTS = ParkBoundWatch/ParkBoundWatch.entitlements;
\t\t\t\tCODE_SIGN_STYLE = Automatic;
\t\t\t\tCURRENT_PROJECT_VERSION = 1;
\t\t\t\tGENERATE_INFOPLIST_FILE = NO;
\t\t\t\tINFOPLIST_FILE = ParkBoundWatch/Info.plist;
\t\t\t\tLD_RUNPATH_SEARCH_PATHS = "$(inherited) @executable_path/Frameworks";
\t\t\t\tMARKETING_VERSION = 1.8.0;
\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = ai.kurat0r.parkbound.watchkitapp;
\t\t\t\tPRODUCT_NAME = "$(TARGET_NAME)";
\t\t\t\tSDKROOT = watchos;
\t\t\t\tSKIP_INSTALL = YES;
\t\t\t\tSWIFT_VERSION = 5.0;
\t\t\t\tTARGETED_DEVICE_FAMILY = 4;
\t\t\t\tWATCHOS_DEPLOYMENT_TARGET = 10.0;
\t\t\t};
\t\t\tname = Release;
\t\t};
/* End XCBuildConfiguration section */`,
  );

  next = next.replace(
    '/* End XCConfigurationList section */',
    `\t\t${ids.cfgList} /* Build configuration list for PBXNativeTarget "ParkBoundWatch" */ = {
\t\t\tisa = XCConfigurationList;
\t\t\tbuildConfigurations = (
\t\t\t\t${ids.cfgDebug} /* Debug */,
\t\t\t\t${ids.cfgRelease} /* Release */,
\t\t\t);
\t\t\tdefaultConfigurationIsVisible = 0;
\t\t\tdefaultConfigurationName = Release;
\t\t};
/* End XCConfigurationList section */`,
  );

  if (!next.includes(ids.target) || !next.includes('Embed Watch Content')) {
    throw new Error('pbxproj wire failed — markers not applied (project format changed?)');
  }
  return { text: next, changed: true };
}

function main() {
  assertWatchSources();
  const original = fs.readFileSync(PBX, 'utf8');
  if (checkOnly) {
    if (!alreadyWired(original)) {
      console.error('CHECK FAIL: ParkBoundWatch is not wired into App.xcodeproj');
      process.exit(1);
    }
    console.log('CHECK OK: ParkBoundWatch target + phone bridge present in pbxproj');
    return;
  }
  const { text, changed } = wire(original);
  if (changed) {
    fs.writeFileSync(PBX, text);
    console.log('Wired ParkBoundWatch + phone bridge into', path.relative(ROOT, PBX));
  } else {
    console.log('Already wired:', path.relative(ROOT, PBX));
  }
  // Re-check
  const after = fs.readFileSync(PBX, 'utf8');
  if (!alreadyWired(after)) {
    throw new Error('Post-wire check failed');
  }
}

main();
