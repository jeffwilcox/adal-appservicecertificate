// Copyright (c) Microsoft Corporation and contributors. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for details.

'use strict';

// In a development environment, it's likely that certificate-based authentication
// will not be used, so it is OK to let the nuget installation fail. This will
// happen when NuGet is not in the path. Override with the config setting
// failifnugetfails.
let allowNuGetFailure = process.env.npm_package_config_failifnugetfails === "0";

const allowedMinutes = 10;

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

  const packagePath = path.resolve(__dirname, '..', 'package.json');
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

  const hrstart = process.hrtime();

  pkg.dependencies['edge'] = edgeVersion;

  if (__dirname.indexOf('node_modules') !== -1) {
    fs.writeFileSync(packagePath, JSON.stringify(pkg, undefined, 2));
    const npmPath = process.env.npm_execpath ? ('"' + process.argv[0] + '" "' + process.env.npm_execpath + '"') : 'npm';
    cp.exec(`${npmPath} install --production`, {
      cwd: __dirname
    }, function (err) {
      if (err) return onError(err);

      const nugetPackages = require(path.resolve(__dirname, '..', 'src', 'nugetPackages.json'));
      const nugetPackagesConfig = path.resolve(__dirname, '..', 'src', 'packages.config');
      fs.writeFileSync(nugetPackagesConfig, jsonToNuGet(nugetPackages));

      let nugetExe = process.env.NUGET_EXE;
      if (!nugetExe) {
        nugetExe = 'nuget';
        console.warn('nuget needs to be in the path or set in the NUGET_EXE environment variable');
      }
      const nugetInstall = `"${nugetExe}" install ${nugetPackagesConfig} -OutputDirectory packages`;
      console.log('Installing NuGet packages: ' + Object.keys(nugetPackages).join(', ') + ' using "' + nugetExe + '"');
      cp.exec(nugetInstall, {
        cwd: path.resolve(__dirname, '../'),
      }, function (err) {
        if (allowNuGetFailure && err) {
          console.warn('NuGet could not be found in the path or there was an installation problem');
          console.warn('However the npm config variable failifnugetfails is 0');
        } else if (err) {
          return onError(err);
        }
        const hrend = process.hrtime(hrstart);
        console.info("Edge + NuGet installation time (hr): %ds %dms", hrend[0], hrend[1]/1000000);
        process.exit(0);
      });
    });

    setTimeout(function () {
      console.error('Installation timed out after an allowed ' + allowedMinutes + ' minutes');
      process.exit(1);
    }, 60 * 1000 * allowedMinutes);
  }
} catch (ex) {
  onError(ex);
}
