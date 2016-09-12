// Copyright (c) Microsoft Corporation and contributors. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for details.

// Windows-only edge install
// Based on concepts used in 'spawn-sync' by forbeslindesay - MIT - [https://github.com/ForbesLindesay/spawn-sync/blob/master/postinstall.js]

// TODO: Consider the NuGet part being a silent failure unless clearly in an App Service environment

'use strict';

// In a development environment, it's likely that certificate-based authentication
// will not be used, so it is OK to let the nuget installation fail. This will 
// happen when NuGet is not in the path. Override with the config setting 
// failifnugetfails.
let allowNuGetFailure = process.env.npm_package_config_failifnugetfails === "0";

function jsonToNuGet(packages) {
  let xml = '<?xml version="1.0" encoding="utf-8"?>\n';
  xml += '<packages>\n';
  for (const packageId in packages) {
    xml += `  <package id="${packageId}" version="${packages[packageId]}" targetFramework="net45" />\n`;
  }
  xml += '</packages>\n';
  return xml;
}

function onError(err) {
  try {
    var str = '' + (err ? (err.stack || err.message || err) : 'null');
    require('fs').writeFileSync(__dirname + '/error.log', str);
    console.error(str);
  } catch (ex) {
  }
  process.exit(1);
}
try {
  const cp = require('child_process');
  const fs = require('fs');
  const os = require('os');
  const path = require('path');

  if (os.platform() !== 'win32') {
    console.log('This module is Windows-specific.');
    return;
  }

  const packagePath = path.resolve(__dirname, 'package.json');
  let pkg = require(packagePath);
  if (pkg.dependencies['edge']) {
    return;
  }

  const edgeVersion = process.env.npm_package_config_edgepackageversion;
  if (!edgeVersion) {
    return onError(new Error('No NPM config set for edgepackageversion'));
  }

  const packageName = pkg.name;
  console.log(`Adding 'edge ${edgeVersion}' to package.json of '${packageName}'`);

  pkg.dependencies['edge'] = edgeVersion;

  if (__dirname.indexOf('node_modules') !== -1) {
    fs.writeFileSync(packagePath, JSON.stringify(pkg, undefined, 2));
    const npmPath = process.env.npm_execpath ? ('"' + process.argv[0] + '" "' + process.env.npm_execpath + '"') : 'npm';
    cp.exec(`${npmPath} install --production`, {
      cwd: __dirname
    }, function (err) {
      if (err) return onError(err);
      
      const nugetPackages = require(path.resolve(__dirname, 'netfxPackages.json'));
      const nugetPackagesConfig = path.resolve(__dirname, 'packages.config');
      fs.writeFileSync(nugetPackagesConfig, jsonToNuGet(nugetPackages));

      let nugetExe = process.env.NUGET_EXE;
      if (!nugetExe) {
        nugetExe = 'nuget';
        console.warn('nuget needs to be in the path or set in the NUGET_EXE environment variable');
      }
      const nugetInstall = `${nugetExe} install ${nugetPackagesConfig}`;
      console.log('Installing NuGet packages...');
      cp.exec(nugetInstall, {
        cwd: __dirname
      }, function (err) {
        if (allowNuGetFailure && err) {
          console.log('NuGet could not be found or had an installation problem.');
          console.log('However the npm config variable failifnugetfails is set to not treat this as an error.');
        } else if (err) {
          return onError(err);
        }
        process.exit(0);
      });
    });

    // 5 minute timeout on installation
    setTimeout(function () {
      console.error('Installation timed out');
      process.exit(1);
    }, 60 * 5 * 1000);
  }
} catch (ex) {
  onError(ex);
}
