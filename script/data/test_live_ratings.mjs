import test from 'node:test';import assert from 'node:assert/strict';import {readPageData} from './read_svelte_data.mjs';
test('read source literals without running JavaScript',()=>{const x=readPageData('<script>kit.start(app,element,{data:[null,{type:"data",data:{off:-1.2,def:.5,name:"Test",values:[1,null,true],missing:void 0}}]});</script>');assert.deepEqual(x,[{off:-1.2,def:.5,name:'Test',values:[1,null,true],missing:null}]);});
test('reject executable data',()=>assert.throws(()=>readPageData('<script>kit.start(app,element,{data:[{type:"data",data:{x:process.exit()}}]});</script>'),/Nonliteral/));
test('detect source format change',()=>assert.throws(()=>readPageData('<html>Login required</html>'),/not found/));
