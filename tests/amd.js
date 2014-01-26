requirejs.config({
    paths: {
        strophe: '../src'
    }
})

require([
    'strophe/base64',
    'strophe/md5'
], function(Base64, MD5)
{
    test("Base64", 3, function()
    {
        equal(typeof Base64, 'object');
        equal(typeof Base64.decode, 'function');
        equal(typeof Base64.encode, 'function');
    });

    test("MD5", 3, function()
    {
        equal(typeof MD5, 'object');
        equal(typeof MD5.hexdigest, 'function');
        equal(typeof MD5.hash, 'function');
    });
});