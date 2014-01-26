requirejs.config({
    paths: {
        strophe: '../src'
    }
})

require([
    'strophe/base64',
    'strophe/md5',
    'strophe/sha1',
], function(Base64, MD5, SHA1)
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

    test("SHA1", 7, function()
    {
        equal(typeof SHA1, 'object');
        equal(typeof SHA1.b64_sha1, 'function');
        equal(typeof SHA1.str_sha1, 'function');
        equal(typeof SHA1.b64_hmac_sha1, 'function');
        equal(typeof SHA1.str_hmac_sha1, 'function');
        equal(typeof SHA1.core_hmac_sha1, 'function');
        equal(typeof SHA1.binb2str, 'function');
    });
});