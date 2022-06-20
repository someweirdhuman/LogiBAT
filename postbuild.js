console.log('Patching .exe to hide terminal');
require('create-nodew-exe')({
   src: './bin/LogiBAT.exe',
   dst: './bin/LogiBAT_patched.exe',
});
