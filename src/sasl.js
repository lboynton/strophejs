(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define(['./base64', './md5', './sha1', './strophe', './connection'], factory);
    } else {
        // Browser globals
        factory(root.Base64, root.MD5, root.SHA1, root.Strophe, root.Strophe.Connection);
    }
}(this, function (Base64, MD5, SHA1, Strophe, Connection) {

    /** Constants: SASL mechanisms
     *  Available authentication mechanisms
     *
     *  Strophe.SASLAnonymous - SASL Anonymous authentication.
     *  Strophe.SASLPlain - SASL Plain authentication.
     *  Strophe.SASLMD5 - SASL Digest-MD5 authentication
     *  Strophe.SASLSHA1 - SASL SCRAM-SHA1 authentication
     */

  // Building SASL callbacks

  /** PrivateConstructor: SASLAnonymous
   *  SASL Anonymous authentication.
   */
  Strophe.SASLAnonymous = function() {};

  Strophe.SASLAnonymous.prototype = new Strophe.SASLMechanism("ANONYMOUS", false, 10);

  Strophe.SASLAnonymous.test = function(connection) {
    return connection.authcid === null;
  };

  Connection.prototype.mechanisms[Strophe.SASLAnonymous.prototype.name] = Strophe.SASLAnonymous;

  /** PrivateConstructor: SASLPlain
   *  SASL Plain authentication.
   */
  Strophe.SASLPlain = function() {};

  Strophe.SASLPlain.prototype = new Strophe.SASLMechanism("PLAIN", true, 20);

  Strophe.SASLPlain.test = function(connection) {
    return connection.authcid !== null;
  };

  Strophe.SASLPlain.prototype.onChallenge = function(connection) {
    var auth_str = connection.authzid;
    auth_str = auth_str + "\u0000";
    auth_str = auth_str + connection.authcid;
    auth_str = auth_str + "\u0000";
    auth_str = auth_str + connection.pass;
    return auth_str;
  };

  Connection.prototype.mechanisms[Strophe.SASLPlain.prototype.name] = Strophe.SASLPlain;

  /** PrivateConstructor: SASLSHA1
   *  SASL SCRAM SHA 1 authentication.
   */
  Strophe.SASLSHA1 = function() {};

  /* TEST:
   * This is a simple example of a SCRAM-SHA-1 authentication exchange
   * when the client doesn't support channel bindings (username 'user' and
   * password 'pencil' are used):
   *
   * C: n,,n=user,r=fyko+d2lbbFgONRv9qkxdawL
   * S: r=fyko+d2lbbFgONRv9qkxdawL3rfcNHYJY1ZVvWVs7j,s=QSXCR+Q6sek8bf92,
   * i=4096
   * C: c=biws,r=fyko+d2lbbFgONRv9qkxdawL3rfcNHYJY1ZVvWVs7j,
   * p=v0X8v3Bz2T0CJGbJQyF0X+HI4Ts=
   * S: v=rmF9pqV8S7suAoZWja4dJRkFsKQ=
   *
   */

  Strophe.SASLSHA1.prototype = new Strophe.SASLMechanism("SCRAM-SHA-1", true, 40);

  Strophe.SASLSHA1.test = function(connection) {
    return connection.authcid !== null;
  };

  Strophe.SASLSHA1.prototype.onChallenge = function(connection, challenge, test_cnonce) {
    var cnonce = test_cnonce || MD5.hexdigest(Math.random() * 1234567890);

    var auth_str = "n=" + connection.authcid;
    auth_str += ",r=";
    auth_str += cnonce;

    connection._sasl_data.cnonce = cnonce;
    connection._sasl_data["client-first-message-bare"] = auth_str;

    auth_str = "n,," + auth_str;

    this.onChallenge = function (connection, challenge)
    {
      var nonce, salt, iter, Hi, U, U_old, i, k;
      var clientKey, serverKey, clientSignature;
      var responseText = "c=biws,";
      var authMessage = connection._sasl_data["client-first-message-bare"] + "," +
        challenge + ",";
      var cnonce = connection._sasl_data.cnonce;
      var attribMatch = /([a-z]+)=([^,]+)(,|$)/;

      while (challenge.match(attribMatch)) {
        var matches = challenge.match(attribMatch);
        challenge = challenge.replace(matches[0], "");
        switch (matches[1]) {
        case "r":
          nonce = matches[2];
          break;
        case "s":
          salt = matches[2];
          break;
        case "i":
          iter = matches[2];
          break;
        }
      }

      if (nonce.substr(0, cnonce.length) !== cnonce) {
        connection._sasl_data = {};
        return connection._sasl_failure_cb();
      }

      responseText += "r=" + nonce;
      authMessage += responseText;

      salt = Base64.decode(salt);
      salt += "\x00\x00\x00\x01";

      Hi = U_old = SHA1.core_hmac_sha1(connection.pass, salt);
      for (i = 1; i < iter; i++) {
        U = SHA1.core_hmac_sha1(connection.pass, SHA1.binb2str(U_old));
        for (k = 0; k < 5; k++) {
          Hi[k] ^= U[k];
        }
        U_old = U;
      }
      Hi = SHA1.binb2str(Hi);

      clientKey = SHA1.core_hmac_sha1(Hi, "Client Key");
      serverKey = SHA1.str_hmac_sha1(Hi, "Server Key");
      clientSignature = SHA1.core_hmac_sha1(SHA1.str_sha1(SHA1.binb2str(clientKey)), authMessage);
      connection._sasl_data["server-signature"] = SHA1.b64_hmac_sha1(serverKey, authMessage);

      for (k = 0; k < 5; k++) {
        clientKey[k] ^= clientSignature[k];
      }

      responseText += ",p=" + Base64.encode(SHA1.binb2str(clientKey));

      return responseText;
    }.bind(this);

    return auth_str;
  };

  Connection.prototype.mechanisms[Strophe.SASLSHA1.prototype.name] = Strophe.SASLSHA1;

  /** PrivateConstructor: SASLMD5
   *  SASL DIGEST MD5 authentication.
   */
  Strophe.SASLMD5 = function() {};

  Strophe.SASLMD5.prototype = new Strophe.SASLMechanism("DIGEST-MD5", false, 30);

  Strophe.SASLMD5.test = function(connection) {
    return connection.authcid !== null;
  };

  /** PrivateFunction: _quote
   *  _Private_ utility function to backslash escape and quote strings.
   *
   *  Parameters:
   *    (String) str - The string to be quoted.
   *
   *  Returns:
   *    quoted string
   */
  Strophe.SASLMD5.prototype._quote = function (str)
    {
      return '"' + str.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
      //" end string workaround for emacs
    };


  Strophe.SASLMD5.prototype.onChallenge = function(connection, challenge, test_cnonce) {
    var attribMatch = /([a-z]+)=("[^"]+"|[^,"]+)(?:,|$)/;
    var cnonce = test_cnonce || MD5.hexdigest("" + (Math.random() * 1234567890));
    var realm = "";
    var host = null;
    var nonce = "";
    var qop = "";
    var matches;

    while (challenge.match(attribMatch)) {
      matches = challenge.match(attribMatch);
      challenge = challenge.replace(matches[0], "");
      matches[2] = matches[2].replace(/^"(.+)"$/, "$1");
      switch (matches[1]) {
      case "realm":
        realm = matches[2];
        break;
      case "nonce":
        nonce = matches[2];
        break;
      case "qop":
        qop = matches[2];
        break;
      case "host":
        host = matches[2];
        break;
      }
    }

    var digest_uri = connection.servtype + "/" + connection.domain;
    if (host !== null) {
      digest_uri = digest_uri + "/" + host;
    }

    var A1 = MD5.hash(connection.authcid +
                      ":" + realm + ":" + this._connection.pass) +
      ":" + nonce + ":" + cnonce;
    var A2 = 'AUTHENTICATE:' + digest_uri;

    var responseText = "";
    responseText += 'charset=utf-8,';
    responseText += 'username=' +
      this._quote(connection.authcid) + ',';
    responseText += 'realm=' + this._quote(realm) + ',';
    responseText += 'nonce=' + this._quote(nonce) + ',';
    responseText += 'nc=00000001,';
    responseText += 'cnonce=' + this._quote(cnonce) + ',';
    responseText += 'digest-uri=' + this._quote(digest_uri) + ',';
    responseText += 'response=' + MD5.hexdigest(MD5.hexdigest(A1) + ":" +
                                                nonce + ":00000001:" +
                                                cnonce + ":auth:" +
                                                MD5.hexdigest(A2)) + ",";
    responseText += 'qop=auth';

    this.onChallenge = function ()
    {
      return "";
    }.bind(this);

    return responseText;
  };

  Connection.prototype.mechanisms[Strophe.SASLMD5.prototype.name] = Strophe.SASLMD5;
}));